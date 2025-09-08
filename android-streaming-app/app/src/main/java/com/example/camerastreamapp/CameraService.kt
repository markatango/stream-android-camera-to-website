package com.example.camerastreamapp

import android.app.*
import android.content.Context
import android.content.Intent
import android.graphics.*
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.util.Base64
import android.util.Log
import androidx.camera.core.*
import androidx.camera.core.Camera
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.google.gson.Gson
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URISyntaxException
import java.util.*
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class CameraService : Service(), LifecycleOwner {

    companion object {
        private const val TAG = "CameraService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "camera_stream_channel"

        // Configuration - reads from BuildConfig
        private val SERVER_URL = BuildConfig.SERVER_URL
        private val DEVICE_SECRET = BuildConfig.DEVICE_SECRET

        // OPTIMIZED FOR REMOTE SERVER
        private const val STREAM_FRAME_RATE = 2  // Reduced from 5 to 2
        private const val JPEG_QUALITY = 30      // Reduced from 70 to 30
    }

    // Lifecycle management
    private val lifecycleRegistry = LifecycleRegistry(this)
    override val lifecycle = lifecycleRegistry

    // Binder for activity communication
    inner class LocalBinder : Binder() {
        fun getService(): CameraService = this@CameraService
    }

    private val binder = LocalBinder()

    // Camera components
    private lateinit var cameraExecutor: ExecutorService
    private var camera: Camera? = null
    private var imageCapture: ImageCapture? = null
    private var imageAnalyzer: ImageAnalysis? = null
    private var cameraProvider: ProcessCameraProvider? = null

    // Socket.IO connection
    private var socket: Socket? = null
    private var authToken: String? = null

    // Service state
    private var isConnected = false
    private var isStreaming = false
    private val serviceScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var serviceCallback: ServiceCallback? = null

    // Device identification
    private val deviceId = "galaxy_s23_${System.currentTimeMillis()}_${(1000..9999).random()}"

    interface ServiceCallback {
        fun onConnectionStatusChanged(connected: Boolean)
        fun onStreamingStatusChanged(streaming: Boolean)
        fun onError(error: String)
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "=== CameraService onCreate ===")
        lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.CREATED

        cameraExecutor = Executors.newSingleThreadExecutor()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, createNotification("Camera service starting..."))

        initializeCamera()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "CameraService onStartCommand")
        lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.STARTED
        return START_STICKY
    }

    override fun onBind(intent: Intent): IBinder {
        Log.d(TAG, "CameraService onBind")
        lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.RESUMED
        return binder
    }

    override fun onUnbind(intent: Intent?): Boolean {
        Log.d(TAG, "CameraService onUnbind")
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        Log.d(TAG, "=== CameraService onDestroy ===")
        super.onDestroy()
        lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.DESTROYED

        socket?.disconnect()
        cameraProvider?.unbindAll()
        cameraExecutor.shutdown()
        serviceScope.cancel()
    }

    fun setServiceCallback(callback: ServiceCallback?) {
        serviceCallback = callback
    }

    private fun initializeCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            try {
                Log.d(TAG, "Camera provider future completed")
                cameraProvider = cameraProviderFuture.get()
                setupCamera()
            } catch (exc: Exception) {
                Log.e(TAG, "Camera initialization failed", exc)
                serviceCallback?.onError("Camera initialization failed")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun setupCamera() {
        try {
            Log.d(TAG, "=== Setting up camera in service ===")

            // Image capture for snapshots
            imageCapture = ImageCapture.Builder()
                .setTargetRotation(android.view.Surface.ROTATION_0)
                .setJpegQuality(JPEG_QUALITY)
                .build()
            Log.d(TAG, "ImageCapture created")

            // Image analysis for streaming - REMOVED deprecated setTargetResolution
            imageAnalyzer = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            Log.d(TAG, "ImageAnalysis created")

            imageAnalyzer?.setAnalyzer(cameraExecutor) { imageProxy ->
                if (isStreaming && isConnected) {
                    processImageForStreaming(imageProxy)
                }
                imageProxy.close()
            }
            Log.d(TAG, "Image analyzer set")

            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
            Log.d(TAG, "Camera selector created")

            // Bind to lifecycle
            cameraProvider?.unbindAll()
            camera = cameraProvider?.bindToLifecycle(
                this,
                cameraSelector,
                imageCapture,
                imageAnalyzer
            )

            Log.d(TAG, "=== Camera setup successful in service ===")

        } catch (exc: Exception) {
            Log.e(TAG, "Camera binding failed", exc)
            serviceCallback?.onError("Camera setup failed")
        }
    }

    private fun processImageForStreaming(imageProxy: ImageProxy) {
        try {
            // Convert ImageProxy to Bitmap using a more reliable method
            val bitmap = imageProxyToBitmap(imageProxy)
            if (bitmap == null) {
                Log.e(TAG, "Failed to convert ImageProxy to Bitmap")
                return
            }

            // Compress to JPEG with reduced quality for remote streaming
            val byteArrayOutputStream = ByteArrayOutputStream()
            val compressed = bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, byteArrayOutputStream)
            if (!compressed) {
                Log.e(TAG, "Failed to compress bitmap to JPEG")
                return
            }

            val byteArray = byteArrayOutputStream.toByteArray()

            // Log size reduction for debugging
            Log.d(TAG, "Image processed: ${bitmap.width}x${bitmap.height} -> ${byteArray.size} bytes")

            // Convert to Base64
            val base64String = Base64.encodeToString(byteArray, Base64.NO_WRAP)

            // Send to server
            val data = JSONObject().apply {
                put("frame", base64String)
                put("timestamp", System.currentTimeMillis())
                put("deviceId", deviceId)
            }

            socket?.emit("camera-stream", data)

        } catch (e: Exception) {
            Log.e(TAG, "Error processing image for streaming", e)
        }
    }

    private fun imageProxyToBitmap(imageProxy: ImageProxy): Bitmap? {
        return try {
            when (imageProxy.format) {
                ImageFormat.YUV_420_888 -> {
                    convertYuv420888ToBitmap(imageProxy)
                }
                else -> {
                    // For other formats, try direct conversion
                    Log.w(TAG, "Unsupported format ${imageProxy.format}, trying direct conversion")
                    null
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in imageProxyToBitmap", e)
            null
        }
    }

    private fun convertYuv420888ToBitmap(imageProxy: ImageProxy): Bitmap? {
        return try {
            val image = imageProxy.image ?: return null
            val planes = image.planes

            val yPlane = planes[0]
            val uPlane = planes[1]
            val vPlane = planes[2]

            val yBuffer = yPlane.buffer
            val uBuffer = uPlane.buffer
            val vBuffer = vPlane.buffer

            val ySize = yBuffer.remaining()
            val uSize = uBuffer.remaining()
            val vSize = vBuffer.remaining()

            val data = ByteArray(ySize + uSize + vSize)

            yBuffer.get(data, 0, ySize)
            uBuffer.get(data, ySize, uSize)
            vBuffer.get(data, ySize + uSize, vSize)

            val yuvImage = YuvImage(
                data,
                ImageFormat.NV21,
                imageProxy.width,
                imageProxy.height,
                null
            )

            val stream = ByteArrayOutputStream()
            yuvImage.compressToJpeg(
                Rect(0, 0, imageProxy.width, imageProxy.height),
                85,
                stream
            )

            val jpegData = stream.toByteArray()
            return BitmapFactory.decodeByteArray(jpegData, 0, jpegData.size)

        } catch (e: Exception) {
            Log.e(TAG, "Error converting YUV to bitmap", e)
            null
        }
    }

    private fun authenticateWithServer() {
        serviceScope.launch(Dispatchers.IO) {
            try {
                Log.d(TAG, "Starting authentication to: $SERVER_URL")
                Log.d(TAG, "Device ID: $deviceId")
                Log.d(TAG, "Device Secret: ${DEVICE_SECRET.take(10)}...")

                val client = OkHttpClient.Builder()
                    .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                    .build()

                val json = JSONObject().apply {
                    put("deviceId", deviceId)
                    put("deviceSecret", DEVICE_SECRET)
                }

                val requestBody = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$SERVER_URL/api/authenticate")
                    .post(requestBody)
                    .addHeader("Content-Type", "application/json")
                    .build()

                val response = client.newCall(request).execute()
                val responseBody = response.body?.string()

                if (response.isSuccessful) {
                    val jsonResponse = JSONObject(responseBody ?: "{}")
                    authToken = jsonResponse.optString("token", null)

                    if (authToken != null) {
                        Log.d(TAG, "Authentication successful, token received")

                        getSharedPreferences("camera_stream", Context.MODE_PRIVATE)
                            .edit()
                            .putString("auth_token", authToken)
                            .apply()

                        withContext(Dispatchers.Main) {
                            connectSocketIO()
                        }
                    } else {
                        Log.e(TAG, "No token in response")
                        withContext(Dispatchers.Main) {
                            serviceCallback?.onError("No auth token received")
                        }
                    }
                } else {
                    Log.e(TAG, "Authentication failed: HTTP ${response.code}")

                    val errorMessage = when (response.code) {
                        401 -> "Unauthorized - Check device secret"
                        404 -> "Server endpoint not found"
                        500 -> "Server error"
                        else -> "HTTP ${response.code}: $responseBody"
                    }

                    withContext(Dispatchers.Main) {
                        serviceCallback?.onError(errorMessage)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Authentication error: ${e.javaClass.simpleName}", e)
                withContext(Dispatchers.Main) {
                    serviceCallback?.onError("Auth error: ${e.message}")
                }
            }
        }
    }

    private fun connectSocketIO() {
        try {
            socket?.disconnect()
            socket = null

            Log.d(TAG, "Connecting to Socket.IO with token: ${authToken?.substring(0, 16)}...")

            val opts = IO.Options().apply {
                auth = mapOf("token" to (authToken ?: ""))
                forceNew = true
                reconnection = true
                reconnectionAttempts = 3
                reconnectionDelay = 1000
            }

            socket = IO.socket(SERVER_URL, opts)

            socket?.on(Socket.EVENT_CONNECT) {
                Log.d(TAG, "Socket connected successfully")
                isConnected = true
                updateNotification("Connected to server")
                serviceCallback?.onConnectionStatusChanged(true)
                startStreaming()
            }

            socket?.on(Socket.EVENT_DISCONNECT) {
                Log.d(TAG, "Socket disconnected")
                isConnected = false
                isStreaming = false
                updateNotification("Disconnected from server")
                serviceCallback?.onConnectionStatusChanged(false)
                serviceCallback?.onStreamingStatusChanged(false)
                stopStreaming()
            }

            socket?.on(Socket.EVENT_CONNECT_ERROR) { args ->
                Log.e(TAG, "Socket connection error: ${args.contentToString()}")
                val errorMessage = args.firstOrNull()?.toString() ?: ""

                if (errorMessage.contains("Authentication failed") || errorMessage.contains("Invalid or expired token")) {
                    Log.w(TAG, "Token invalid, clearing and re-authenticating...")
                    getSharedPreferences("camera_stream", Context.MODE_PRIVATE)
                        .edit()
                        .remove("auth_token")
                        .apply()
                    authToken = null
                    serviceScope.launch {
                        delay(1000)
                        authenticateWithServer()
                    }
                } else {
                    serviceCallback?.onError("Connection error: ${args.firstOrNull()}")
                }
            }

            socket?.on("take-snapshot") {
                handleSnapshotRequest()
            }

            socket?.on("start-streaming-command") {
                Log.d(TAG, "Received start streaming command from server")
                startStreaming()
            }

            socket?.on("stop-streaming-command") {
                Log.d(TAG, "Received stop streaming command from server")
                stopStreaming()
            }

            socket?.on("connected") { args ->
                Log.d(TAG, "Server welcome message: ${args.contentToString()}")
            }

            socket?.connect()

        } catch (e: URISyntaxException) {
            Log.e(TAG, "Socket URI error", e)
            serviceCallback?.onError("Invalid server URL")
        }
    }

    private fun startStreaming() {
        Log.d(TAG, "startStreaming() called - isConnected=$isConnected, isStreaming=$isStreaming")
        if (isConnected && !isStreaming) {
            Log.d(TAG, "Setting isStreaming to true and starting camera streaming")
            isStreaming = true
            updateNotification("Streaming active")
            serviceCallback?.onStreamingStatusChanged(true)

            val data = JSONObject().apply {
                put("isStreaming", true)
                put("deviceId", deviceId)
            }
            socket?.emit("streaming-state-update", data)

            Log.d(TAG, "Streaming started successfully - isStreaming=$isStreaming")
        } else {
            Log.w(TAG, "Cannot start streaming - isConnected=$isConnected, isStreaming=$isStreaming")
        }
    }

    private fun stopStreaming() {
        Log.d(TAG, "stopStreaming() called - isStreaming=$isStreaming")
        if (isStreaming) {
            Log.d(TAG, "Setting isStreaming to false and stopping camera streaming")
            isStreaming = false
            updateNotification("Streaming stopped")
            serviceCallback?.onStreamingStatusChanged(false)

            val data = JSONObject().apply {
                put("isStreaming", false)
                put("deviceId", deviceId)
            }
            socket?.emit("streaming-state-update", data)

            Log.d(TAG, "Streaming stopped successfully - isStreaming=$isStreaming")
        } else {
            Log.w(TAG, "Cannot stop streaming - already stopped")
        }
    }

    private fun handleSnapshotRequest() {
        Log.d(TAG, "Snapshot request received")

        serviceScope.launch(Dispatchers.IO) {
            try {
                val dummyBase64 = "dummy_snapshot_data"
                val data = JSONObject().apply {
                    put("imageData", dummyBase64)
                    put("timestamp", System.currentTimeMillis())
                    put("deviceId", deviceId)
                }
                socket?.emit("snapshot-data", data)
                Log.d(TAG, "Snapshot sent")
            } catch (e: Exception) {
                Log.e(TAG, "Error capturing snapshot", e)
            }
        }
    }

    // Public methods for MainActivity
    fun connectToServer() {
        if (!isConnected) {
            Log.d(TAG, "Clearing any existing token and starting fresh authentication")
            getSharedPreferences("camera_stream", Context.MODE_PRIVATE)
                .edit()
                .remove("auth_token")
                .apply()
            authToken = null
            authenticateWithServer()
        }
    }

    fun disconnectFromServer() {
        socket?.disconnect()
        isConnected = false
        isStreaming = false
        serviceCallback?.onConnectionStatusChanged(false)
        serviceCallback?.onStreamingStatusChanged(false)
        updateNotification("Disconnected")
    }

    fun startCameraStreaming() {
        Log.d(TAG, "startCameraStreaming() called - current state: connected=$isConnected, streaming=$isStreaming")
        startStreaming()
    }

    fun stopCameraStreaming() {
        Log.d(TAG, "stopCameraStreaming() called")
        stopStreaming()
    }

    fun isServiceConnected(): Boolean = isConnected
    fun isServiceStreaming(): Boolean = isStreaming
    fun getCameraDeviceId(): String = deviceId

    fun setupPreviewForActivity(previewView: androidx.camera.view.PreviewView) {
        Log.d(TAG, "Request to setup camera preview for MainActivity...")

        serviceScope.launch(Dispatchers.Main) {
            try {
                if (cameraProvider == null) {
                    Log.w(TAG, "Camera provider not ready yet")
                    return@launch
                }

                val preview = Preview.Builder().build()
                preview.setSurfaceProvider(previewView.surfaceProvider)

                val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

                cameraProvider?.unbindAll()
                camera = cameraProvider?.bindToLifecycle(
                    this@CameraService,
                    cameraSelector,
                    preview,
                    imageCapture,
                    imageAnalyzer
                )

                Log.d(TAG, "Camera preview setup successful for MainActivity")

            } catch (exc: Exception) {
                Log.e(TAG, "Camera preview setup failed", exc)
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Camera Stream Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Background camera streaming service"
                setShowBadge(false)
            }

            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(content: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Camera Stream")
            .setContentText(content)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(content: String) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID, createNotification(content))
    }
}
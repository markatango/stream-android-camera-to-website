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

        // Configuration - Replace with your server details
        private val SERVER_URL = BuildConfig.SERVER_URL
        private val DEVICE_SECRET = BuildConfig.DEVICE_SECRET // Replace with your secret

        private const val STREAM_FRAME_RATE = 5 // Frames per second (adjust for performance)
        private const val JPEG_QUALITY = 70 // JPEG quality (1-100)
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
    private var deviceId: String = generateDeviceId()

    // Service state
    private var isConnected = false
    private var isStreaming = false

    // Coroutine scope
    private val serviceScope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // Callback interface for activity updates
    interface ServiceCallback {
        fun onConnectionStatusChanged(connected: Boolean)
        fun onStreamingStatusChanged(streaming: Boolean)
        fun onError(error: String)
    }

    private var serviceCallback: ServiceCallback? = null

    fun setServiceCallback(callback: ServiceCallback?) {
        this.serviceCallback = callback
    }

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service created")

        lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.CREATED

        createNotificationChannel()
        cameraExecutor = Executors.newSingleThreadExecutor()

        // Start as foreground service
        startForeground(NOTIFICATION_ID, createNotification("Camera service starting..."))

        // Initialize camera
        initializeCamera()

        lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.STARTED
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "CONNECT" -> connectToServer()
            "DISCONNECT" -> disconnectFromServer()
            "START_STREAMING" -> startStreaming()
            "STOP_STREAMING" -> stopStreaming()
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent): IBinder {
        return binder
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "Service destroyed")

        lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.DESTROYED

        cleanup()
        cameraExecutor.shutdown()
        serviceScope.cancel()
    }

    private fun generateDeviceId(): String {
        return "galaxy_s23_${System.currentTimeMillis()}_${Random().nextInt(10000)}"
    }

    private fun initializeCamera() {
        Log.d(TAG, "=== Initializing camera in service ===")
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

            // Image analysis for streaming
            imageAnalyzer = ImageAnalysis.Builder()
                .setTargetResolution(android.util.Size(640, 480))
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

            // Compress to JPEG
            val byteArrayOutputStream = ByteArrayOutputStream()
            val compressed = bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, byteArrayOutputStream)
            if (!compressed) {
                Log.e(TAG, "Failed to compress bitmap to JPEG")
                return
            }

            val byteArray = byteArrayOutputStream.toByteArray()

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

    // Replace your existing convertYuv420888ToBitmap function with this version:

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

            // Device-specific UV plane detection
            val deviceInfo = "${Build.MANUFACTURER} ${Build.MODEL} (API ${Build.VERSION.SDK_INT})"
            Log.d(TAG, "Processing frame on device: $deviceInfo")

            val needsUvSwap = detectUvSwapNeeded()
            Log.d(TAG, "UV swap needed: $needsUvSwap")

            val data = ByteArray(ySize + uSize + vSize)

            // Copy Y plane (always first)
            yBuffer.get(data, 0, ySize)

            if (needsUvSwap) {
                // Swap UV: V first, then U (for Samsung, some OnePlus, etc.)
                vBuffer.get(data, ySize, vSize)
                uBuffer.get(data, ySize + vSize, uSize)
                Log.d(TAG, "Applied UV swap for device compatibility")
            } else {
                // Standard UV: U first, then V
                uBuffer.get(data, ySize, uSize)
                vBuffer.get(data, ySize + uSize, vSize)
                Log.d(TAG, "Using standard UV order")
            }

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
                JPEG_QUALITY,
                stream
            )

            val jpegData = stream.toByteArray()
            BitmapFactory.decodeByteArray(jpegData, 0, jpegData.size)

        } catch (e: Exception) {
            Log.e(TAG, "Error converting YUV to bitmap", e)
            null
        }
    }

    // Device detection function - add this as a new function in your CameraService class
    private fun detectUvSwapNeeded(): Boolean {
        val manufacturer = Build.MANUFACTURER.lowercase()
        val model = Build.MODEL.lowercase()
        val brand = Build.BRAND.lowercase()
        val sdk = Build.VERSION.SDK_INT

        return when {
            // Samsung devices (most common case)
            manufacturer.contains("samsung") -> {
                Log.d(TAG, "Samsung device detected - UV swap needed")
                true
            }

            // OnePlus devices (varies by model)
            manufacturer.contains("oneplus") -> {
                val needsSwap = when {
                    model.contains("7") || model.contains("8") || model.contains("9") -> true
                    model.contains("nord") -> true
                    sdk < 28 -> true // Older OnePlus devices
                    else -> false
                }
                Log.d(TAG, "OnePlus device: $model, UV swap: $needsSwap")
                needsSwap
            }

            // Some Xiaomi devices (older ones mainly)
            manufacturer.contains("xiaomi") || brand.contains("redmi") -> {
                val needsSwap = sdk < 28 // Older Xiaomi devices often need swap
                Log.d(TAG, "Xiaomi/Redmi device, API $sdk, UV swap: $needsSwap")
                needsSwap
            }

            // Some Huawei devices
            manufacturer.contains("huawei") || brand.contains("honor") -> {
                val needsSwap = sdk < 29
                Log.d(TAG, "Huawei/Honor device, API $sdk, UV swap: $needsSwap")
                needsSwap
            }

            // Oppo devices (some models)
            manufacturer.contains("oppo") -> {
                val needsSwap = model.contains("find") || sdk < 28
                Log.d(TAG, "Oppo device: $model, UV swap: $needsSwap")
                needsSwap
            }

            // Vivo devices (some models)
            manufacturer.contains("vivo") -> {
                val needsSwap = sdk < 28
                Log.d(TAG, "Vivo device, API $sdk, UV swap: $needsSwap")
                needsSwap
            }

            // Google Pixel and most other devices use standard format
            manufacturer.contains("google") ||
                    manufacturer.contains("sony") ||
                    manufacturer.contains("motorola") ||
                    manufacturer.contains("nokia") -> {
                Log.d(TAG, "Standard UV format device: $manufacturer")
                false
            }

            // Unknown devices - default to standard, but log for future reference
            else -> {
                Log.w(TAG, "Unknown device: $manufacturer $model - using standard UV format. " +
                        "If colors are wrong, please report this device for database update.")
                false
            }
        }
    }

    // Optional: Add a manual override function for testing
    private fun testColorCorrection() {
        // You can call this for testing specific devices
        Log.d(TAG, "=== Device Color Test Info ===")
        Log.d(TAG, "Manufacturer: ${Build.MANUFACTURER}")
        Log.d(TAG, "Model: ${Build.MODEL}")
        Log.d(TAG, "Brand: ${Build.BRAND}")
        Log.d(TAG, "SDK Version: ${Build.VERSION.SDK_INT}")
        Log.d(TAG, "UV Swap Needed: ${detectUvSwapNeeded()}")
        Log.d(TAG, "=============================")
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

    private fun authenticateWithServer() {
        serviceScope.launch(Dispatchers.IO) {
            try {
                Log.d(TAG, "Starting authentication to: $SERVER_URL")
                Log.d(TAG, "Device ID: $deviceId")
                Log.d(TAG, "Device Secret: ${DEVICE_SECRET.take(10)}...") // Only log first 10 chars for security

                val client = OkHttpClient.Builder()
                    .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                    .build()

                val json = JSONObject().apply {
                    put("deviceId", deviceId)
                    put("deviceSecret", DEVICE_SECRET)
                }

                Log.d(TAG, "Authentication payload: $json")

                val requestBody = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$SERVER_URL/api/authenticate")
                    .post(requestBody)
                    .addHeader("Content-Type", "application/json")
                    .build()

                Log.d(TAG, "Sending authentication request...")
                val response = client.newCall(request).execute()
                Log.d(TAG, "Response code: ${response.code}")

                val responseBody = response.body?.string()
                Log.d(TAG, "Response body: $responseBody")

                if (response.isSuccessful) {
                    val jsonResponse = JSONObject(responseBody ?: "{}")
                    authToken = jsonResponse.optString("token", null)

                    if (authToken != null) {
                        Log.d(TAG, "Authentication successful, token received")

                        // Save token to shared preferences
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
                    Log.e(TAG, "Error response: $responseBody")

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
            } catch (e: java.net.ConnectException) {
                Log.e(TAG, "Connection failed - server unreachable", e)
                withContext(Dispatchers.Main) {
                    serviceCallback?.onError("Cannot reach server. Check IP and network.")
                }
            } catch (e: java.net.UnknownHostException) {
                Log.e(TAG, "Unknown host - DNS resolution failed", e)
                withContext(Dispatchers.Main) {
                    serviceCallback?.onError("Cannot resolve server address. Check IP.")
                }
            } catch (e: java.net.SocketTimeoutException) {
                Log.e(TAG, "Request timeout", e)
                withContext(Dispatchers.Main) {
                    serviceCallback?.onError("Server timeout. Check if server is running.")
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
            // Clear any existing socket connection
            socket?.disconnect()
            socket = null

            Log.d(TAG, "Connecting to Socket.IO with token: ${authToken?.substring(0, 16)}...")

            val opts = IO.Options().apply {
                auth = mapOf("token" to (authToken ?: ""))
                forceNew = true  // Force new connection
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

                // Auto-start streaming when connected
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

                // Check if it's an authentication error
                val errorMessage = args.firstOrNull()?.toString() ?: ""
                if (errorMessage.contains("Authentication failed") || errorMessage.contains("Invalid or expired token")) {
                    Log.w(TAG, "Token invalid, clearing and re-authenticating...")

                    // Clear stored token
                    getSharedPreferences("camera_stream", Context.MODE_PRIVATE)
                        .edit()
                        .remove("auth_token")
                        .apply()

                    authToken = null

                    // Re-authenticate with fresh token
                    serviceScope.launch {
                        delay(1000) // Wait a bit before retrying
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

            // Notify server of state change
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

            // Notify server of state change
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
                // This is a simplified snapshot - in production you'd want to
                // capture a high-quality image using ImageCapture
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
            // Clear any old token first
            Log.d(TAG, "Clearing any existing token and starting fresh authentication")
            getSharedPreferences("camera_stream", Context.MODE_PRIVATE)
                .edit()
                .remove("auth_token")
                .apply()

            authToken = null

            // Always authenticate fresh
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

    // Set up camera preview for MainActivity
    fun setupPreviewForActivity(previewView: androidx.camera.view.PreviewView) {
        Log.d(TAG, "Request to setup camera preview for MainActivity...")

        serviceScope.launch(Dispatchers.Main) {
            try {
                // Wait for camera provider to be ready
                if (cameraProvider == null) {
                    Log.d(TAG, "Camera provider not ready yet, waiting...")
                    // Wait up to 5 seconds for camera provider to be ready
                    var attempts = 0
                    while (cameraProvider == null && attempts < 50) {
                        delay(100)
                        attempts++
                    }

                    if (cameraProvider == null) {
                        Log.e(TAG, "Camera provider still not ready after waiting")
                        return@launch
                    }
                }

                Log.d(TAG, "Camera provider ready, setting up preview...")

                // Create preview for MainActivity
                val preview = Preview.Builder()
                    .setTargetResolution(android.util.Size(720, 1280))
                    .build().also {
                        Log.d(TAG, "Setting surface provider for MainActivity preview")
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }

                val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

                // Unbind and rebind with preview included
                cameraProvider?.unbindAll()

                // Bind preview along with existing use cases
                camera = cameraProvider?.bindToLifecycle(
                    this@CameraService,
                    cameraSelector,
                    preview,
                    imageCapture,
                    imageAnalyzer
                )

                Log.d(TAG, "=== MainActivity camera preview bound successfully ===")

            } catch (exc: Exception) {
                Log.e(TAG, "Failed to setup preview for MainActivity", exc)
            }
        }
    }

    private fun cleanup() {
        stopStreaming()
        cameraProvider?.unbindAll()
        socket?.disconnect()
    }
}
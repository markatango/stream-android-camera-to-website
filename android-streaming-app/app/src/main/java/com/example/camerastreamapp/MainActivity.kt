package com.example.camerastreamapp

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.example.camerastreamapp.databinding.ActivityMainBinding
import kotlinx.coroutines.launch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity(), CameraService.ServiceCallback {

    companion object {
        private const val TAG = "MainActivity"
        private val REQUIRED_PERMISSIONS = mutableListOf(
            Manifest.permission.CAMERA,
            Manifest.permission.INTERNET,
            Manifest.permission.ACCESS_NETWORK_STATE
        ).apply {
            if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
                add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }.toTypedArray()
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var cameraExecutor: ExecutorService

    // Service binding
    private var cameraService: CameraService? = null
    private var isServiceBound = false

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as CameraService.LocalBinder
            cameraService = binder.getService()
            cameraService?.setServiceCallback(this@MainActivity)
            isServiceBound = true

            Log.d(TAG, "Service bound successfully")
            updateUI()

            // Set up camera preview after service is bound
            setupCameraPreview()
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            cameraService = null
            isServiceBound = false
            Log.d(TAG, "Service unbound")
        }
    }

    // Permission request launcher
    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        var allGranted = true
        permissions.entries.forEach {
            if (!it.value) {
                allGranted = false
                Log.e(TAG, "Permission ${it.key} denied")
            }
        }

        if (allGranted) {
            Log.d(TAG, "All permissions granted, starting camera service")
            startCameraService() // Service will handle camera preview setup
        } else {
            showPermissionDeniedDialog()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "=== MainActivity onCreate ===")
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        cameraExecutor = Executors.newSingleThreadExecutor()

        setupClickListeners()

        Log.d(TAG, "Checking permissions...")
        if (allPermissionsGranted()) {
            Log.d(TAG, "All permissions granted in onCreate, starting camera service")
            startCameraService() // Service will handle camera setup
        } else {
            Log.d(TAG, "Requesting permissions...")
            requestPermissions()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()

        if (isServiceBound) {
            unbindService(serviceConnection)
        }
    }

    private fun setupClickListeners() {
        binding.buttonConnect.setOnClickListener {
            Log.d(TAG, "=== CONNECT BUTTON CLICKED ===")
            if (cameraService?.isServiceConnected() == true) {
                Log.d(TAG, "Disconnecting from server...")
                cameraService?.disconnectFromServer()
            } else {
                Log.d(TAG, "Connecting to server...")
                cameraService?.connectToServer()
            }
        }

        binding.buttonStream.setOnClickListener {
            Log.d(TAG, "=== STREAM BUTTON CLICKED ===")
            Log.d(TAG, "Service bound: $isServiceBound")
            Log.d(TAG, "Service: $cameraService")
            Log.d(TAG, "Current streaming state: ${cameraService?.isServiceStreaming()}")
            Log.d(TAG, "Current connection state: ${cameraService?.isServiceConnected()}")

            if (cameraService?.isServiceStreaming() == true) {
                Log.d(TAG, "Calling stopCameraStreaming()...")
                cameraService?.stopCameraStreaming()
            } else {
                Log.d(TAG, "Calling startCameraStreaming()...")
                cameraService?.startCameraStreaming()
            }
            Log.d(TAG, "=== END BUTTON CLICK ===")
        }

        binding.buttonSettings.setOnClickListener {
            showSettingsDialog()
        }
    }

    private fun setupCamera() {
        // Let the service handle the camera completely
        // We'll show preview through the service
        Log.d(TAG, "MainActivity: Camera setup delegated to service")
    }

    private fun setupCameraPreview() {
        Log.d(TAG, "Setting up camera preview via service...")

        if (isServiceBound && cameraService != null) {
            Log.d(TAG, "Service is bound, requesting preview setup")
            cameraService?.setupPreviewForActivity(binding.previewView)
        } else {
            Log.w(TAG, "Service not bound yet, cannot setup preview")
            // Try again after a delay
            binding.previewView.postDelayed({
                setupCameraPreview()
            }, 1000)
        }
    }

    private fun startCameraService() {
        Log.d(TAG, "Starting camera service...")
        val intent = Intent(this, CameraService::class.java)
        ContextCompat.startForegroundService(this, intent)
        Log.d(TAG, "Binding to camera service...")
        bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    private fun allPermissionsGranted() = REQUIRED_PERMISSIONS.all {
        ContextCompat.checkSelfPermission(baseContext, it) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestPermissions() {
        requestPermissionLauncher.launch(REQUIRED_PERMISSIONS)
    }

    private fun showPermissionDeniedDialog() {
        AlertDialog.Builder(this)
            .setTitle("Permissions Required")
            .setMessage("This app requires camera and network permissions to stream video. Please grant all permissions to continue.")
            .setPositiveButton("Grant Permissions") { _, _ ->
                requestPermissions()
            }
            .setNegativeButton("Exit") { _, _ ->
                finish()
            }
            .setCancelable(false)
            .show()
    }

    private fun showSettingsDialog() {
        val deviceId = cameraService?.getCameraDeviceId() ?: "Unknown"

        AlertDialog.Builder(this)
            .setTitle("Device Information")
            .setMessage("Device ID: $deviceId\n\nServer: 192.168.1.26:3001\n\nStreaming Status: ${if (cameraService?.isServiceStreaming() == true) "Active" else "Inactive"}")
            .setPositiveButton("OK", null)
            .show()
    }

    private fun updateUI() {
        lifecycleScope.launch {
            val isConnected = cameraService?.isServiceConnected() ?: false
            val isStreaming = cameraService?.isServiceStreaming() ?: false

            // Update connection button
            binding.buttonConnect.text = if (isConnected) "Disconnect" else "Connect"

            // Update streaming button
            binding.buttonStream.text = if (isStreaming) "Stop Streaming" else "Start Streaming"
            binding.buttonStream.isEnabled = isConnected

            // Update status text
            val status = when {
                isStreaming -> "🔴 STREAMING"
                isConnected -> "🟢 CONNECTED"
                else -> "🔴 DISCONNECTED"
            }
            binding.textStatus.text = status

            // Update device ID
            binding.textDeviceId.text = "Device: ${cameraService?.getCameraDeviceId() ?: "Unknown"}"
        }
    }

    // ServiceCallback implementations
    override fun onConnectionStatusChanged(connected: Boolean) {
        runOnUiThread {
            updateUI()
            val message = if (connected) "Connected to server" else "Disconnected from server"
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
        }
    }

    override fun onStreamingStatusChanged(streaming: Boolean) {
        runOnUiThread {
            updateUI()
            val message = if (streaming) "Streaming started" else "Streaming stopped"
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
        }
    }

    override fun onError(error: String) {
        runOnUiThread {
            Toast.makeText(this, "Error: $error", Toast.LENGTH_LONG).show()
            updateUI()
        }
    }
}
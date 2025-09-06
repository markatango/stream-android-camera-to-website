import java.util.Properties
import java.io.FileInputStream

val localProperties = Properties()
val localPropertiesFile = rootProject.file("local.properties")

println("Local properties file exists: ${localPropertiesFile.exists()}")
println("Local properties file path: ${localPropertiesFile.absolutePath}")

if (localPropertiesFile.exists()) {
    localProperties.load(FileInputStream(localPropertiesFile))
    println("DEVICE_SECRET value: '${localProperties.getProperty("DEVICE_SECRET", "NOT_FOUND")}'")
    println("All properties: ${localProperties.stringPropertyNames()}")
}

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}


android {
    namespace = "com.example.camerastreamapp"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.camerastreamapp"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            val secret = localProperties.getProperty("DEVICE_SECRET", "FALLBACK_SECRET")
            val server_url = localProperties.getProperty("SERVER_URL", "FALLBACK_SERVER_URL")
            println("Using secret for debug: '$secret'")
            println("Using server_url for debug: '$server_url'")
            buildConfigField("String", "DEVICE_SECRET", "\"$secret\"")
            buildConfigField("String", "SERVER_URL", "\"$server_url\"")
        }
        release {
            val secret = localProperties.getProperty("DEVICE_SECRET", "FALLBACK_SECRET")
            val server_url = localProperties.getProperty("SERVER_URL", "FALLBACK_SERVER_URL")
            println("Using secret for release: '$secret'")
            println("Using server_url for release: '$server_url'")
            buildConfigField("String", "DEVICE_SECRET", "\"$secret\"")
            buildConfigField("String", "SERVER_URL", "\"$server_url\"")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = "1.8"
    }

    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.constraintlayout)
    implementation(libs.androidx.lifecycle.runtime.ktx)

    // Camera dependencies
    implementation(libs.camera.core)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)

    // Network dependencies
    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.gson)
    implementation(libs.coroutines.android)

    // Socket.IO
    implementation(libs.socketio) {
        exclude(group = "org.json", module = "json")
    }

    // Testing
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}

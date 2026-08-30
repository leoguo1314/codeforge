plugins {
    id("com.android.application")
}

android {
    namespace = "ai.codeforge.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "ai.codeforge.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "0.3.0"
        manifestPlaceholders["usesCleartextTraffic"] = "false"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            isMinifyEnabled = false
            manifestPlaceholders["usesCleartextTraffic"] = "false"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

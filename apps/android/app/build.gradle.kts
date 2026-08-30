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
        versionCode = 2
        versionName = "0.2.0"
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

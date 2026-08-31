plugins {
    id("com.android.application")
}

fun buildEnv(name: String): String = System.getenv(name)?.trim().orEmpty()

fun quotedBuildConfig(value: String): String =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "ai.codeforge.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "ai.codeforge.android"
        minSdk = 26
        targetSdk = 36
        versionCode = 8
        versionName = "0.8.0"
        manifestPlaceholders["usesCleartextTraffic"] = "false"

        // Firebase project configuration is intentionally injected at build time.
        // These values identify the Firebase app but are never hard-coded into the repo.
        buildConfigField(
            "String",
            "FIREBASE_APPLICATION_ID",
            quotedBuildConfig(buildEnv("CODEFORGE_FIREBASE_APPLICATION_ID")),
        )
        buildConfigField(
            "String",
            "FIREBASE_PROJECT_ID",
            quotedBuildConfig(buildEnv("CODEFORGE_FIREBASE_PROJECT_ID")),
        )
        buildConfigField(
            "String",
            "FIREBASE_API_KEY",
            quotedBuildConfig(buildEnv("CODEFORGE_FIREBASE_API_KEY")),
        )
        buildConfigField(
            "String",
            "FIREBASE_SENDER_ID",
            quotedBuildConfig(buildEnv("CODEFORGE_FIREBASE_SENDER_ID")),
        )

        // Huawei Push Kit can also be configured without committing an
        // agconnect-services.json file. The App ID is injected by the build.
        buildConfigField(
            "String",
            "HUAWEI_APP_ID",
            quotedBuildConfig(buildEnv("CODEFORGE_HUAWEI_APP_ID")),
        )
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

dependencies {
    implementation("androidx.core:core:1.16.0")
    implementation(platform("com.google.firebase:firebase-bom:34.18.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.huawei.hms:push:6.13.0.300")
}

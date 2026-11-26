plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.reputationtenability.scanner"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.reputationtenability.scanner"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        // The portal this app files exhibits into. Override per build with -PportalUrl=https://...
        val portalUrl = (project.findProperty("portalUrl") as String?)
            ?: "https://portal-production-05b34530.up.railway.app"
        buildConfigField("String", "PORTAL_URL", "\"$portalUrl\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources.excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*")
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")

    // Google ML Kit document scanner: edge detection, perspective crop, multi-page, no camera permission needed
    implementation("com.google.android.gms:play-services-mlkit-document-scanner:16.0.0-beta1")
    // PDF creation (Apache 2.0)
    implementation("com.tom-roush:pdfbox-android:2.0.27.0")
    // Networking + encrypted token storage
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.security:security-crypto:1.0.0")
}

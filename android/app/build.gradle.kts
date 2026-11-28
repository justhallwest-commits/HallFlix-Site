plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Every build gets a higher version code (from GitHub Actions' run number), so a new APK installs over the old one.
val buildNumber = (System.getenv("BUILD_NUMBER") ?: "1").toInt()
val keystore = System.getenv("HALLFLIX_KEYSTORE")

android {
    namespace = "net.hallflix.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "net.hallflix.app"
        minSdk = 22          // Fire OS 5 (2nd-gen Fire TV Stick) and up
        targetSdk = 34
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    signingConfigs {
        create("release") {
            if (keystore != null) {
                storeFile = file(keystore)
                storePassword = System.getenv("HALLFLIX_KEYSTORE_PASSWORD")
                keyAlias = "hallflix"
                keyPassword = System.getenv("HALLFLIX_KEYSTORE_PASSWORD")
                storeType = "pkcs12"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystore != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { checkReleaseBuilds = false; abortOnError = false }
}

dependencies {
    val media3 = "1.4.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.core:core-ktx:1.13.1")
    // The native TV screens: sideways rows and the library grid, and artwork loading with a memory and disk cache.
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("com.github.bumptech.glide:glide:4.16.0")
    // Continue watching on Android TV's own home screen.
    implementation("androidx.tvprovider:tvprovider:1.0.0")
}

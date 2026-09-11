import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// The upload key, read from a file that is never committed — see the family
// app's copy for why Play's key and this one are different things. The driver
// app has its own keystore rather than sharing one: two products with two
// listings, and a key compromised in one should not reach the other.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        FileInputStream(keystorePropertiesFile).use { load(it) }
    }
}
val hasUploadKey = keystorePropertiesFile.exists()

android {
    namespace = "com.carebridge.driver"
    // Pinned rather than inherited from `flutter.compileSdkVersion`.
    // `flutter_secure_storage` — which is what keeps tokens in the
    // Keychain and EncryptedSharedPreferences rather than in plain
    // preferences — compiles against 37, and the Flutter default is
    // still 36. Inheriting it also means a Flutter upgrade can move
    // the API level the app is built against without any diff, which
    // is not something to discover from a store review.
    compileSdk = 37
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Immutable once Play has accepted an upload under it, and it must
        // match the iOS bundle identifier for no technical reason at all —
        // only so that one product is one name in both consoles, in the
        // analytics, and in whatever a support ticket says it is using.
        applicationId = "com.carebridge.driver"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (hasUploadKey) {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = keystoreProperties["storeFile"]?.let { file(it) }
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasUploadKey) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

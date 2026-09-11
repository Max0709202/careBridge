import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// The upload key, read from a file that is never committed.
//
// `key.properties` sits beside this module's root and is in .gitignore along
// with the keystore itself. Play signs the app it serves with a key it holds;
// what this signs is the *upload*, and Play refuses a bundle whose upload key
// it has not seen before. Losing it is not a password reset — it is a support
// ticket — so the runbook keeps the copy, not the repository.
val keystorePropertiesFile = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        FileInputStream(keystorePropertiesFile).use { load(it) }
    }
}
val hasUploadKey = keystorePropertiesFile.exists()

android {
    namespace = "com.carebridge.family"
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
        // Reserved in the Play Console before the first upload and immutable
        // afterwards: an application id cannot be changed on a listing, only
        // abandoned for a new one that loses every install and review.
        applicationId = "com.carebridge.family"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion

        // Both are taken from `version:` in pubspec.yaml — `0.1.0+1` is
        // versionName 0.1.0 and versionCode 1. Play rejects a bundle whose
        // versionCode it has already accepted, so the number after the `+` is
        // what a re-upload increments.
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
            // A developer with no keystore still gets a working
            // `flutter run --release`; what they do not get is a bundle that
            // looks uploadable. The debug key is rejected by Play at upload,
            // which is the right place to find out — far better than a green
            // build that is silently unshippable.
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

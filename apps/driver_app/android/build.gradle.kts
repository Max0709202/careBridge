allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// Pin every plugin's compileSdk to the app's.
//
// Android 17 introduced minor API levels, so the SDK repository publishes
// `platforms;android-37.0` and no plain `platforms;android-37`. A plugin that
// declares `compileSdk = 37` — flutter_secure_storage 11.0.0 does — makes AGP
// resolve the hash string `android-37`, which cannot be installed and cannot
// be found, and the build dies before it compiles a line:
//
//   Failed to find target with hash string 'android-37' in: .../Android/Sdk
//
// Overriding here rather than forking the plugin: the app compiles against 36
// and every plugin should agree with it, which is the invariant we actually
// want. Removable once the plugins move to `compileSdk = 37` with an explicit
// `compileSdkMinor`, or once AGP resolves a bare 37 to 37.0 itself.
subprojects {
    if (name != "app") {
        afterEvaluate {
            val android = extensions.findByType<com.android.build.gradle.BaseExtension>()
            val appCompileSdk =
                project(":app")
                    .extensions
                    .findByType<com.android.build.gradle.BaseExtension>()
                    ?.compileSdkVersion
            if (android != null && appCompileSdk != null &&
                android.compileSdkVersion == "android-37"
            ) {
                android.compileSdkVersion(appCompileSdk)
            }
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}

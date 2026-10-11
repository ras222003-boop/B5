plugins { id("com.android.application") }
android {
  namespace = "sa.basira.depthlab"
  compileSdk = 35
  defaultConfig {
    applicationId = "sa.basira.depthlab"
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "0.1.0"
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}
dependencies {
  implementation("com.google.ar:core:1.56.0")
}

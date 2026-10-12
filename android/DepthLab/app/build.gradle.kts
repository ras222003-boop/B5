plugins { id("com.android.application") }
val basiraVisionUrl = providers.gradleProperty("basiraVisionUrl")
  .orElse("https://YOUR-BASIRA-DOMAIN.example/navigation/vision").get()
android {
  namespace = "sa.basira.depthlab"
  compileSdk = 35
  buildFeatures { buildConfig = true }
  defaultConfig {
    applicationId = "sa.basira.depthlab"
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "0.1.0"
    buildConfigField("String", "BASIRA_VISION_URL", "\"${basiraVisionUrl.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}
dependencies {
  implementation("com.google.ar:core:1.56.0")
  implementation("androidx.webkit:webkit:1.14.0")
}

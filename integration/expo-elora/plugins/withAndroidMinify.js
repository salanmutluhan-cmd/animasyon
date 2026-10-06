// Google Play "DEX kodu optimizasyonu / kod karartma" uyarısı için:
// Android release derlemelerinde R8 (kod küçültme + karartma) ve kaynak küçültmeyi açar.
// Expo'nun Android şablonu bu iki ayarı gradle.properties'ten okur. expo-build-properties
// eklentisi bu Expo sürümünde sorun çıkardığı için (bkz. withGoogleMobileAdsKotlinVersion.js)
// sadece bu ayarları hedefli şekilde ekliyoruz. Ayrıca kullanılan kütüphanelerin
// silinmemesi / adının değişmemesi gereken kısımları için koruma kuralları yazılır.
const fs = require("fs");
const path = require("path");
const { withGradleProperties, withDangerousMod } = require("@expo/config-plugins");

const PROPS = {
  "android.enableProguardInReleaseBuilds": "true",
  "android.enableShrinkResourcesInReleaseBuilds": "true",
};

const MARK = "# --- Elora: koruma kuralları ---";
const RULES = `
${MARK}
# React Native / Hermes
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * { @com.facebook.proguard.annotations.DoNotStrip *; }
# WebView (pati dostu) — JavaScript köprüsü adları değişmemeli
-keep class com.reactnativecommunity.webview.** { *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
# SVG
-keep public class com.horcrux.svg.** { *; }
# Google Mobile Ads (AdMob)
-keep class io.invertase.googlemobileads.** { *; }
-keep class com.google.android.gms.ads.** { *; }
-dontwarn com.google.android.gms.**
# Expo modülleri
-keep class expo.modules.** { *; }
-dontwarn expo.modules.**
# Sentry
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**
# AsyncStorage, Slider
-keep class com.reactnativecommunity.asyncstorage.** { *; }
-keep class com.reactnativecommunity.slider.** { *; }
`;

function withMinifyProps(config) {
  return withGradleProperties(config, (config) => {
    Object.entries(PROPS).forEach(([key, value]) => {
      const item = config.modResults.find((i) => i.type === "property" && i.key === key);
      if (item) item.value = value;
      else config.modResults.push({ type: "property", key, value });
    });
    return config;
  });
}

function withKeepRules(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const file = path.join(config.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
      let txt = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (!txt.includes(MARK)) fs.writeFileSync(file, txt + "\n" + RULES);
      return config;
    },
  ]);
}

module.exports = function withAndroidMinify(config) {
  return withKeepRules(withMinifyProps(config));
};

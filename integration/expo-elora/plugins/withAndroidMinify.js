// Google Play "DEX kodu optimizasyonu / kod karartma" uyarısı için:
// Android release derlemelerinde R8 (kod küçültme + karartma) ve kaynak küçültmeyi açar.
// Expo'nun Android şablonu bu iki ayarı gradle.properties'ten okur. expo-build-properties
// eklentisi bu Expo sürümünde sorun çıkardığı için (bkz. withGoogleMobileAdsKotlinVersion.js)
// sadece bu ayarları hedefli şekilde ekliyoruz. Ayrıca kullanılan kütüphanelerin
// silinmemesi / adının değişmemesi gereken kısımları için koruma kuralları yazılır.
const fs = require("fs");
const path = require("path");
const { withGradleProperties, withDangerousMod, withAppBuildGradle } = require("@expo/config-plugins");

// Expo sürümüne göre ayarın adı farklı: eski şablon "enableProguard...", yeni şablon "enableMinify..." okur.
// İkisini de yazıyoruz. Kaynak küçültme (shrinkResources) yalnızca kod küçültme açıkken çalışır.
const PROPS = {
  "android.enableProguardInReleaseBuilds": "true",
  "android.enableMinifyInReleaseBuilds": "true",
  "android.enableShrinkResourcesInReleaseBuilds": "true",
};

const MARK = "# --- Elora: koruma kuralları ---";
const RULES = `
${MARK}
# Not: Kütüphaneler (React Native, Expo, AdMob, Sentry, WebView) kendi R8 kurallarını
# zaten getirir. Burada sadece gerçekten gereken dar kurallar var; geniş "-keep ... { *; }"
# kuralları kodun büyük kısmını karartmadan bırakıp Play'deki "kod karartma" oranını düşürür.
# React Native / Hermes (küçük paketler, yerel kod bu adlarla çağırır)
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * { @com.facebook.proguard.annotations.DoNotStrip *; }
# SVG: özellik adları yansıma (reflection) ile okunur, adları değişmemeli
-keep public class com.horcrux.svg.** { *; }
# WebView (pati dostu) — JavaScript köprüsü metotları
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
# Uyarıları sustur (eksik isteğe bağlı sınıflar derlemeyi durdurmasın)
-dontwarn com.google.android.gms.**
-dontwarn expo.modules.**
-dontwarn io.sentry.**
-dontwarn com.facebook.react.**
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
      const at = txt.indexOf(MARK);
      if (at >= 0) txt = txt.slice(0, at); // eski (geniş) kurallar varsa yenileriyle değiştir
      fs.writeFileSync(file, txt.trimEnd() + "\n" + RULES);
      return config;
    },
  ]);
}

// Güvenlik: app/build.gradle içindeki "minifyEnabled ..." satırını doğrudan "true" yapar.
// Böyle bir satır bulunamazsa kaynak küçültmeyi kapatır ki derleme hata vermesin.
function withMinifyGradle(config) {
  return withAppBuildGradle(config, (config) => {
    let g = config.modResults.contents;
    if (/minifyEnabled\s+[^\n]+/.test(g)) {
      g = g.replace(/minifyEnabled\s+[^\n]+/g, "minifyEnabled true");
    } else {
      g = g.replace(/shrinkResources\s+[^\n]+/g, "shrinkResources false");
    }
    config.modResults.contents = g;
    return config;
  });
}

module.exports = function withAndroidMinify(config) {
  return withKeepRules(withMinifyGradle(withMinifyProps(config)));
};

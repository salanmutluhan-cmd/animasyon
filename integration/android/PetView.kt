// Android (Kotlin) — WebView ile hayvan animasyonu
//
// Kurulum:
//   1) integration/android/assets/pet.html dosyasını  app/src/main/assets/pet.html  olarak kopyalayın.
//   2) Bu dosyayı projenize ekleyin (paket adını kendi paketinizle değiştirin).
//   3) Layout'a ekleyin:
//        <com.example.pet.PetView
//            android:id="@+id/petView"
//            android:layout_width="match_parent"
//            android:layout_height="420dp" />
//   4) Kullanım:
//        petView.onStats = { json -> prefs.edit().putString("pet", json.toString()).apply() }
//        petView.load(species = "dog", savedState = prefs.getString("pet", null))
//        feedButton.setOnClickListener { petView.feedTreat() }
//
// Alt tepsideki Mama / Su / Duş araçları hayvanın içinde hazır gelir; kullanıcı parmağıyla
// sürükleyerek kullanır. Butonlardan da tetiklemek isterseniz aşağıdaki metodları çağırın.
package com.example.pet

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.AttributeSet
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

class PetView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : WebView(context, attrs) {

    /** Saniyede bir gelir: {species, stats:{fullness,hydration,energy,happiness,cleanliness}, sleeping, mood, lastUpdate} */
    var onStats: ((JSONObject) -> Unit)? = null
    var onMood: ((String) -> Unit)? = null
    var onAction: ((name: String, phase: String) -> Unit)? = null
    var onReady: (() -> Unit)? = null
    /** Tüm olaylar: "level", "quest", "userWater", "userMood", "buy", "med", "groom", "say" ... */
    var onEvent: ((type: String, data: JSONObject?) -> Unit)? = null
    /** Kullanıcı balondaki "İçtim ✓" butonuna bastı → uygulamada su kaydı ekleyebilirsiniz */
    var onUserDrankWater: (() -> Unit)? = null

    private val main = Handler(Looper.getMainLooper())
    private var pendingSpecies = "dog"
    private var pendingState: String? = null

    init {
        @SuppressLint("SetJavaScriptEnabled")
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        setBackgroundColor(Color.TRANSPARENT)
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        overScrollMode = OVER_SCROLL_NEVER
        webViewClient = WebViewClient()
        addJavascriptInterface(Bridge(), "AndroidPet")
    }

    /** species: "dog" | "cat". savedState: daha önce onStats ile kaydettiğiniz JSON (varsa). */
    fun load(species: String = "dog", savedState: String? = null, breed: String? = null) {
        pendingSpecies = species
        pendingState = savedState
        loadUrl("file:///android_asset/pet.html?species=$species" + (breed?.let { "&breed=$it" } ?: ""))
    }

    fun feedTreat() = send("""{"type":"treat"}""")     // elle mama: ağza götürülür
    fun feedBowl() = send("""{"type":"feed"}""")       // mama kabından yer
    fun giveWater() = send("""{"type":"water"}""")
    fun bathe() = send("""{"type":"bath"}""")          // duş + silkelenme
    fun throwBall() = send("""{"type":"ball"}""")      // top oyunu
    /** kibble, meat, treat, veggie, milk, cake — hayvan seçilen mamayı yer */
    fun feedFood(food: String) = send("""{"type":"feedFood","food":"$food"}""")
    /** false → ışık söner, perde kapanır, hayvan uyur. true → uyanır */
    fun setLights(on: Boolean) = send("""{"type":"lights","on":$on}""")
    fun toggleLights() = send("""{"type":"toggleLights"}""")
    /** ball, laser, bubbles, butterfly */
    fun startGame(name: String) = send("""{"type":"game","name":"$name"}""")
    fun stopGame() = send("""{"type":"stopGame"}""")
    /** banyoya geç (ekran sağa kayar) / odaya dön. Banyodayken yemek ve oyun komutları çalışmaz */
    fun goBath() = send("""{"type":"scene","scene":"bath"}""")
    fun goRoom() = send("""{"type":"scene","scene":"room"}""")
    fun brushFur() = send("""{"type":"brushFur"}""")         // banyoda tüylerini tarar
    fun brushTeeth() = send("""{"type":"brushTeeth"}""")     // dişlerini fırçalar
    /** thermo, syrup, vitamin */
    fun giveMedicine(id: String) = send("""{"type":"medicine","id":"$id"}""")

    // ---- Regl uygulamasıyla bağlantı
    /** phase: "period", "pms", "follicular", "ovulation", "luteal" (null → kapalı). day: regl'in kaçıncı günü */
    fun setCycle(phase: String?, day: Int = 0) = send(if (phase == null) """{"type":"cycle","phase":null}""" else """{"type":"cycle","phase":"$phase","day":$day}""")
    /** happy, sad, tired, pain, angry, anxious */
    fun setUserMood(mood: String) = send("""{"type":"userMood","mood":"$mood"}""")
    fun remindWater() = send("""{"type":"remindWater"}""")
    /** dakika; 0 → kapalı (varsayılan 120) */
    fun setWaterReminder(minutes: Int) = send("""{"type":"waterReminder","minutes":$minutes}""")
    fun userDrankWater() = send("""{"type":"userDrankWater"}""")

    // ---- İlerleme: seviye, pati parası, kıyafet, görev
    /** Örn. kullanıcı günlük kaydını girince ödül: reward(10, 5) */
    fun reward(xp: Int, coins: Int) = send("""{"type":"reward","xp":$xp,"coins":$coins}""")
    fun buy(id: String) = send("""{"type":"buy","id":"$id"}""")
    fun wear(id: String) = send("""{"type":"wear","id":"$id"}""")
    fun unwear(slot: String? = null) = send(if (slot == null) """{"type":"unwear"}""" else """{"type":"unwear","slot":"$slot"}""")
    /** quests, shop, wardrobe, mood, vet */
    fun openPanel(name: String) = send("""{"type":"panel","name":"$name"}""")
    fun say(text: String, seconds: Double = 3.0) = send(JSONObject().put("type", "say").put("text", text).put("duration", seconds).toString())
    fun setName(name: String) = send(JSONObject().put("type", "setName").put("name", name).toString())
    fun setSound(on: Boolean) = send("""{"type":"sound","on":$on}""")
    /** golden, kangal, dalmatian, husky, bulldog, beagle, pug, labrador, collie, shiba, rottweiler, pomeranian,
     *  tabby, van, ankara, british, siamese, tuxedo, calico, black, silver, mainecoon, scottish */
    fun setBreed(breed: String) = send("""{"type":"setBreed","breed":"$breed"}""")
    /** brown, darkbrown, hazel, green, emerald, blue, iceblue, amber, yellow, copper, grey, odd, oddgreen  (null → cinse göre) */
    fun setEyes(eyes: String?) = send(if (eyes == null) """{"type":"setEyes","eyes":null}""" else """{"type":"setEyes","eyes":"$eyes"}""")
    fun sleep() = send("""{"type":"sleep"}""")
    fun wake() = send("""{"type":"wake"}""")
    fun petOnce() = send("""{"type":"pet"}""")
    fun celebrate() = send("""{"type":"celebrate"}""")
    fun setSpecies(species: String) = send("""{"type":"setSpecies","species":"$species"}""")
    fun setState(stateJson: String) = send("""{"type":"setState","state":$stateJson}""")
    fun pauseAnimation() = send("""{"type":"pause"}""")
    fun resumeAnimation() = send("""{"type":"resume"}""")

    fun send(json: String) {
        val arg = JSONObject.quote(json)
        main.post { evaluateJavascript("window.petCommand && window.petCommand($arg);", null) }
    }

    private inner class Bridge {
        @JavascriptInterface
        fun postMessage(message: String) {
            val msg = try { JSONObject(message) } catch (e: Exception) { return }
            if (msg.optString("source") != "pet") return
            val data = msg.optJSONObject("data")
            main.post {
                onEvent?.invoke(msg.optString("type"), data)
                when (msg.optString("type")) {
                    "ready" -> {
                        pendingState?.let { setState(it) }
                        onReady?.invoke()
                    }
                    "stats" -> data?.let { onStats?.invoke(it) }
                    "mood" -> data?.let { onMood?.invoke(it.optString("mood")) }
                    "action" -> data?.let { onAction?.invoke(it.optString("name"), it.optString("phase")) }
                    "userWater" -> onUserDrankWater?.invoke()
                }
            }
        }
    }
}

/* Activity / Fragment yaşam döngüsü:
override fun onPause()  { super.onPause();  petView.pauseAnimation(); petView.onPause() }
override fun onResume() { super.onResume(); petView.onResume(); petView.resumeAnimation() }
*/

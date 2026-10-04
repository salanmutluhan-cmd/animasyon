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
    fun load(species: String = "dog", savedState: String? = null) {
        pendingSpecies = species
        pendingState = savedState
        loadUrl("file:///android_asset/pet.html?species=$species")
    }

    fun feedTreat() = send("""{"type":"treat"}""")     // elle mama: ağza götürülür
    fun feedBowl() = send("""{"type":"feed"}""")       // mama kabından yer
    fun giveWater() = send("""{"type":"water"}""")
    fun bathe() = send("""{"type":"bath"}""")          // duş + silkelenme
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
                when (msg.optString("type")) {
                    "ready" -> {
                        setSpecies(pendingSpecies)
                        pendingState?.let { setState(it) }
                        onReady?.invoke()
                    }
                    "stats" -> data?.let { onStats?.invoke(it) }
                    "mood" -> data?.let { onMood?.invoke(it.optString("mood")) }
                    "action" -> data?.let { onAction?.invoke(it.optString("name"), it.optString("phase")) }
                }
            }
        }
    }
}

/* Activity / Fragment yaşam döngüsü:
override fun onPause()  { super.onPause();  petView.pauseAnimation(); petView.onPause() }
override fun onResume() { super.onResume(); petView.onResume(); petView.resumeAnimation() }
*/

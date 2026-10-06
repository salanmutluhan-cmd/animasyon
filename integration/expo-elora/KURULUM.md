# Elora uygulamasına pati dostu ekleme

Bu klasördeki dosyalar Elora (Expo) uygulamasına evcil hayvanı ekler.
Hazır paketi kullanıyorsan bu adımları yapmana gerek yok; zip içindeki proje zaten hazır.

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `PetScreen.js` | Hayvanın açıldığı tam ekran pencere (WebView). Uygulamanın ana klasörüne kopyala |
| `pet/petHtml.js` | Hayvanın kendisi (tek dosya). `pet` klasörüyle birlikte ana klasöre kopyala |
| `App.js.patch` | `App.js` dosyasında yapılan değişiklikler |

## Adımlar

1. `PetScreen.js` dosyasını ve `pet` klasörünü uygulamanın ana klasörüne (App.js'in yanına) kopyala.
2. Terminalde uygulama klasöründe şu komutu çalıştır: `npx expo install react-native-webview`
3. `App.js.patch` içindeki değişiklikleri uygula (`git apply App.js.patch` ya da elle). Yapılanlar:
   - Üst çubuğa, zil butonunun soluna bir **pati** butonu eklenir.
   - Ana sayfada çevrim çarkının altına bir **"Pati dostun"** kartı eklenir.
   - Takvimde güne dokununca açılan pencereye ve ana sayfadaki "Bugünün kaydı" kartına **ruh hali** eklenir (6 yüz simgesi).
   - Reklamlar Expo Go ile test için geçici olarak kapalı (`ADS_ENABLED = false`). Play Store'a yüklemeden önce `true` yap.
   - Pati dostu penceresinin altında banner reklam, mağaza/mama menüsünde **ödüllü reklam** (ca-app-pub-8745931553835647/9451314687), hayvan ya da ismi değişince **geçiş reklamı** (ca-app-pub-8745931553835647/5415396599). Reklamlar kapalıyken (Expo Go) ödüllü reklam düğmesi test için parayı doğrudan verir.
   - Hayvanın kaydı (para, seviye, mama, kıyafet) her açılışta telefondan yeniden okunur.
   - Hayvanla konuşurken verilen cevaplar `handlePetLog` ile **o günün kaydına** yazılır:
     - **Ruh hali** → `saveMood`
     - **Şikayet** → `addNote` (kullanıcı kendisi yazdıysa hazır şikayetlere de eklenir)
     - **Ağrı** → `savePain` (1-10)
     - **İlaç** → `addMedication` + `createMedPreset` (elle eklemedeki gibi hazır ilaçlara da girer)
   - Döngü bilgisi (regl günü, PMS, yumurtlama, regle kaç gün kaldı) ve bugün elle girilen kayıtlar hayvana gönderilir. Böylece elle girdiğin şeyleri hayvan tekrar sormaz.

## Hayvan ne zaman sorar?

- Uygulama açıkken hayvan ekranına girildiğinde, günde bir kez: "Bugün nasılsın?" → "Bir şikayetin var mı?" → (regl / PMS günlerinde ya da şikayet seçildiyse) "Ağrın 10 üzerinden ne kadar?" → (regl günlerinde) "İlaç içtin mi?" → "Hangi ilacı içtin?"
- Regle 0-2 gün kala: "Reglin yarın başlayabilir. Çantana ped koydun mu?"
- "Henüz değil" denirse 2 saat sonra ilacı tekrar sorar.
- Sağ üstteki **Konuş** butonuyla istediğin zaman konuşma başlatılabilir.

Hayvanın verileri (seviye, para, kıyafetler, görevler) telefonda `pet-state` anahtarıyla ayrı saklanır; regl verilerine karışmaz.

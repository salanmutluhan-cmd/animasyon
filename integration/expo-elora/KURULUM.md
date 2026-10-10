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
   - Reklamlar açık (`ADS_ENABLED = true`). Expo Go ile test ederken istersen `false` yapabilirsin; Expo Go'da reklam zaten görünmez.
   - Pati dostu penceresinin altında banner reklam, mağaza/mama menüsünde **ödüllü reklam** (ca-app-pub-8745931553835647/9451314687), hayvan ya da ismi değişince **geçiş reklamı** (ca-app-pub-8745931553835647/5415396599). Reklamlar kapalıyken ve geliştirme modunda (Expo Go) ödüllü reklam düğmesi test için parayı doğrudan verir; mağaza sürümünde para sadece reklam sonuna kadar izlenirse verilir.
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

## Google Play: kod küçültme ve karartma (R8)

`plugins/withAndroidMinify.js` eklentisi Android release derlemelerinde R8'i (kod küçültme + karartma) ve kaynak küçültmeyi açar.
`app.json` içindeki `plugins` listesine `"./plugins/withAndroidMinify"` eklenmelidir. Kütüphanelerin bozulmaması için koruma kuralları `proguard-rules.pro` dosyasına otomatik yazılır.
Yayına göndermeden önce `preview` profiliyle bir APK alıp telefonda denemen önerilir (reklamlar, pati dostu, takvim, bildirimler).

## Döngü çarkı ve performans (sürüm 1.1.0, yeni derleme)

- Anasayfadaki çark yenilendi: sarmaşık, çiçekler (regl pembe, doğurgan mor, yumurtlama sarı), uğur böceği (bugün), kelebekler, arı ve parıltılar. Animasyonlar telefonun kendi animasyon motorunda döner (`useNativeDriver`), JavaScript'i yormaz. Çarka dokununca giriş animasyonu tekrar oynar. Hayvan ekranı açıkken ve çark ekranda değilken animasyonlar durur.
- Pati dostu ekranı hafifletildi: oda ayrı bir katmanda (her karede yeniden çizilmez), değişmeyen değerler tekrar yazılmaz, sakin anlarda saniyede 30 kare, 90/120 Hz ekranlarda en fazla 60 kare. Hayvanın kaydı telefona en fazla 10 saniyede bir yazılır; ekran kapanınca ve uygulama arka plana atılınca hemen yazılır.
- R8 kuralları daraltıldı: kütüphaneler kendi kurallarını getirdiği için geniş `-keep` kuralları kaldırıldı, kodun çok daha büyük kısmı karartılır.

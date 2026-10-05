# 🐾 Pet Bakım Mini Oyunu: Animasyon Motoru

Regl takip uygulaması için **köpek ve kedi bakma** mini oyunu. Hayvan 2D, karşıdan görünüyor ve cartoon tarzında çizilmiş.
**İki ayağı üstünde duruyor**, kollarını kullanıyor, ekranda yürümüyor.
Her şey tek bir HTML dosyasında çalışıyor, dış bağlantı gerekmiyor.

| Ayakta | Kabı tutup yeme | Ağzını silme | Su içme | Duşta ovalanma |
|---|---|---|---|---|
| ![](docs/ayakta.png) | ![](docs/mama-kabi.png) | ![](docs/agiz-silme.png) | ![](docs/su-icme.png) | ![](docs/dus.png) |

| Silkelenme | Uyku (oturur) | Demo |
|---|---|---|
| ![](docs/silkelenme.png) | ![](docs/uyku.png) | ![](docs/demo-telefon.png) |

**23 gerçek cins:**

![](docs/cinsler.png)

| Mama menüsü | Oyun: kelebek | Işık kapalı (uyku) |
|---|---|---|
| ![](docs/mama-menusu.png) | ![](docs/kelebek.png) | ![](docs/isik-kapali.png) |

**Top oyunu** (patiyle vurma, kafa topu):

![](docs/top-oyunu.png)

## Hızlı deneme

`demo.html` **tek başına çalışır**. Telefona gönderip Chrome ile açabilirsiniz.
GitHub'da dosyaya tıklamak sayfayı çalıştırmaz, sadece kodunu gösterir. Dosyayı indirip açın.

## Oynanış ve kol hareketleri

| Ne yapılır | Hayvan ne yapar |
|---|---|
| **Mama** tuşuna bas | 6 çeşit mamanın olduğu menü açılır. Birini seç ve ağzına sürükle |
| Mamayı ağzına sürükle | Mamaya bakar, iki eliyle uzanır, ağzını açar, salyası akar. Bırakınca mamayı patileriyle tutup ısırarak yer, sonra **patisiyle ağzını siler** ve karnını sıvazlar. Tokken başını çevirir ve eliyle "hayır" yapar |
| **Su** kabını hayvana sürükle | Kabı iki eliyle tutup diliyle içer, sonra ağzını siler |
| **Top**u tutup fırlat | Gözleriyle topu izler. Top tutulurken kollarını açıp hazır bekler. Top yakına gelince patisiyle vurur, kafasının üstüne düşerse kafa atar, yerde ayaklarının yanındaysa tekme atar ("boing!"). Top duvarlardan ve yerden seker |
| **Banyo** tuşuna bas → **sünger** | Süngeri hayvanın üstünde gezdir, her yer köpüklenir. Gözlerini sıkar, kendini ovalar |
| **Banyo** → **duş başlığı** | Su köpükleri durular, köpükler patlar |
| Duş başlığını bırak | Kollarını çırparak **silkelenir**, su saçar, köpükler patlar, tüyleri kabarır, kollarını havaya kaldırıp "tertemiz!" pozu verir |
| Parmağını hayvanın üstünde gezdir | Elleri göğsünde birleşir, sallanır, gözleri ^^ olur, yanakları kızarır. Kedi mırlar |
| Kafasına dokun | Patilerini yanaklarına koyup kıkırdar |
| Karnına dokun | Gıdıklanır |
| **Oyun** tuşuna bas | Top, lazer, baloncuk ya da kelebek seç. Üstteki ✕ ile oyun biter |
| **Işık** (ampul) tuşu | Işık söner, perde kapanır, oda kararır, hayvan uyur. Tekrar basınca ışık yanar ve uyanır |
| Uyut | Esneyip kollarını gerer, **yere oturur** (pembe pati yastıkları görünür), elleri kucağında uyur |
| Uyandır | Gözünü ovuşturur, kalkar, gerinir |

**Kendiliğinden yaptıkları** (ruh haline göre):
- **Mutlu:** el sallar, dans eder, zıplar.
- **Aç:** karnını tutar, karnı guruldar.
- **Yorgun:** gözünü ovuşturur, esner.
- **Susamış:** eliyle yüzünü yelpazeler.
- **Kirli:** kafasını ve karnını kaşır, çamur lekeleri görünür, koku çıkar.
- **Üzgün:** elleri önde birleşik, iç çeker.

## Mamalar

| id | Köpek | Kedi | Etkisi |
|---|---|---|---|
| `kibble` | Kuru mama | Kuru mama | 🍖30 😊1 ⚡2 (çok besleyici) |
| `meat` | Tavuk but | Ton balığı | 🍖22 😊5 ⚡8 (enerji verir) |
| `treat` | Kemik bisküvi | Balık ödülü | 🍖8 😊12 (mutlu eder) |
| `veggie` | Havuç | Kedi otu | 🍖6 😊3 💧6 ⚡4 (sağlıklı) |
| `milk` | Süt | Süt | 🍖8 😊5 💧18 (susuzluk giderir) |
| `cake` | Pati kurabiyesi | Pati kurabiyesi | 🍖10 😊18 ⚡4 (çok mutlu eder) |

🍖 tokluk, 😊 mutluluk, 💧 su, ⚡ enerji. `pet.getFoods()` listeyi verir.

## Sesler ve isim

- Ses efektleri telefonda üretilir, ses dosyası gerekmez: yeme (çıtırtı), su içme (şapırtı), köpük, duş suyu, silkelenme, topa vurma, baloncuk patlaması, havlama/miyavlama, horlama.
- Telefonlar sesi ancak kullanıcı ekrana bir kez dokunduktan sonra açar. Bu normaldir.
- `pet.setSound(false)` sesi kapatır.
- `pet.setName('Pamuk')` hayvanın üstünde isim etiketi gösterir. İsim `stats` ile birlikte kaydedilir.
- `PetEngine.headThumb('van')` cinsin kafa resmini SVG olarak verir (cins seçme ekranı için).

## Özelleştirme

**Köpek cinsleri:** Golden Retriever, Kangal, Dalmaçyalı, Sibirya Kurdu (Husky), İngiliz Bulldog, Beagle, Pug, Siyah Labrador, Border Collie, Shiba Inu, Rottweiler, Pomeranian

**Kedi cinsleri:** Sarman (Tekir), Van Kedisi, Ankara Kedisi, British Shorthair, Siyam, Smokin (Siyah-Beyaz), Üç Renkli (Calico), Siyah Kedi, Gri Tekir, Maine Coon, Scottish Fold

Her cinsin kendine özgü özellikleri var:
- **Desen:** benek, maske, tekir çizgisi, siyam uçları, Van lekesi, eyer gibi.
- **Kulak:** sarkık, küçük sarkık, dik ya da katlanmış.
- **Tüy yoğunluğu, pati rengi ve varsayılan göz rengi.**

**Göz renkleri:** Kahverengi, Koyu kahve, Ela, Yeşil, Zümrüt, Mavi, Buz mavisi, Kehribar, Sarı, Bakır, Gri, Ela-Mavi (Van tipi iki farklı göz), Mavi-Yeşil

```js
pet.setBreed('kangal');   // cins değiştir
pet.setEyes('iceblue');   // göz rengi (null → cinsin kendi rengi)
pet.getBreeds('cat');     // liste: [{id, name, species, swatch:[renkler]}]
```

| id | Cins | id | Cins |
|---|---|---|---|
| `golden` | Golden Retriever | `tabby` | Sarman (Tekir) |
| `kangal` | Kangal | `van` | Van Kedisi |
| `dalmatian` | Dalmaçyalı | `ankara` | Ankara Kedisi |
| `husky` | Husky | `british` | British Shorthair |
| `bulldog` | İngiliz Bulldog | `siamese` | Siyam |
| `beagle` | Beagle | `tuxedo` | Smokin |
| `pug` | Pug | `calico` | Üç Renkli |
| `labrador` | Siyah Labrador | `black` | Siyah Kedi |
| `collie` | Border Collie | `silver` | Gri Tekir |
| `shiba` | Shiba Inu | `mainecoon` | Maine Coon |
| `rottweiler` | Rottweiler | `scottish` | Scottish Fold |
| `pomeranian` | Pomeranian | | |

## Android'e entegrasyon (Kotlin)

1. `integration/android/assets/pet.html` dosyasını `app/src/main/assets/pet.html` olarak kopyalayın.
2. `integration/android/PetView.kt` dosyasını projeye ekleyin ve paket adını kendi paketinizle değiştirin.

```xml
<com.example.pet.PetView
    android:id="@+id/petView"
    android:layout_width="match_parent"
    android:layout_height="520dp" />
```
```kotlin
val prefs = getSharedPreferences("pet", MODE_PRIVATE)
petView.onStats = { json -> prefs.edit().putString("state", json.toString()).apply() }
petView.load(breed = "golden", savedState = prefs.getString("state", null))

// Kullanıcının seçimlerinden:
petView.setBreed("dalmatian")
petView.setEyes("blue")

// İsteğe bağlı butonlar (ekrandaki sürüklenebilir araçlar zaten hazır):
petView.feedFood("meat"); petView.giveWater(); petView.bathe(); petView.sleep(); petView.wake()
petView.startGame("laser"); petView.stopGame()      // ball, laser, bubbles, butterfly
petView.setLights(false); petView.toggleLights()    // ışık kapalı → uyur
petView.setName("Pamuk"); petView.setSound(true)
```

React Native (`integration/react-native/`) ve Flutter (`integration/flutter/`) için de aynı metodlar var.

## Köprü protokolü

**Uygulama → hayvan** (`window.petCommand(json)`):
```js
{type:'treat'} {type:'feed'} {type:'water'} {type:'bath'} {type:'ball'}
{type:'sleep'} {type:'wake'} {type:'pet'} {type:'celebrate'} {type:'yawn'} {type:'play', name:'dance'}
{type:'setBreed', breed:'van'}  {type:'setEyes', eyes:'odd'}  {type:'setSpecies', species:'cat'}
{type:'getBreeds', species:'dog'}
{type:'feedFood', food:'cake'} {type:'getFoods'}
{type:'game', name:'bubbles'} {type:'stopGame'}
{type:'lights', on:false} {type:'toggleLights'}
{type:'setName', name:'Pamuk'} {type:'sound', on:true} {type:'headThumb', breed:'van'}
{type:'setState', state:{ breed, eyes, stats:{fullness, hydration, energy, happiness, cleanliness}, sleeping, lastUpdate }}
{type:'setTimeScale', value:1} {type:'pause'} {type:'resume'} {type:'getState'}
```

**Hayvan → uygulama** (`{source:'pet', type, data}`):
`ready`, `stats` (saniyede bir; `breed` ve `eyes` dahil, kaydetmek için ideal), `mood`, `action`, `play` (topa vurdu),
`drag`, `pet`, `sleep`, `wake`, `breed`, `breeds`, `state`, `foods`, `headThumb`.

## Durumu kaydetme

`stats` olayıyla gelen objeyi saklayın, uygulama açılınca `setState` ile geri verin.
Cins, göz rengi ve istatistikler birlikte geri yüklenir. `lastUpdate` sayesinde uygulama kapalıyken geçen süre de hesaba katılır.

## Ayarlar

`new PetEngine(el, { breed, eyes, name, sound, tools, background, quality, petScale, labels, timeScale, decay, stats })`

| Seçenek | Varsayılan | Açıklama |
|---|---|---|
| `breed` | `'golden'` | yukarıdaki cins id'lerinden biri |
| `eyes` | cinse göre | göz rengi id |
| `tools` | `true` | alt tepsideki Mama / Su / Oyun / Işık / Banyo tuşları |
| `background` | `true` | oda (koltuk, raf, pencere, halı). `false` → şeffaf |
| `quality` | `'high'` | `'low'` → tüy dokusu kapalı (çok eski telefonlar için) |
| `name` | `''` | hayvanın adı |
| `sound` | `true` | ses efektleri |
| `labels` | `{food:'Mama', water:'Su', game:'Oyun', light:'Işık', bath:'Banyo'}` | tuş yazıları |

Önerilen alan oranı **3:4 civarı dikey**.

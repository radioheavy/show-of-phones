# Show of Phones 📱

**Her sunum “lütfen telefonlarınızı kapatın” diye başlar. Seninki öyle başlamayacak.**

Show of Phones sunumunu salonun oynadığı bir oyuna çevirir. Üç ekran, tek canlı salon:

- **Sahne:** projeksiyondaki sunumun. Salon cevapladıkça oylar dolar, kart eğilir, sayaçlar uçar.
- **Cebin:** telefonun kumandan (ileri, geri, karart, sayfaya git, notlar, süre, canlı sayaçlar).
- **Salon:** herkes tek bir QR okutur, kendi telefonundan oy verir, kart kaydırır, dokunur. Uygulama yok.

Üstelik elle kurmuyorsun: **Claude bir konuşma koçu gibi seninle konuşur, sunumu yazar, kendi
Cloudflare hesabına yayınlar ve seni mekâna hazırlar.**

**Canlı demo ve tanıtım:** https://showofphones.oktaydak.com · **Örnek sunum:** https://showofphones.oktaydak.com/merhaba-salon/

Gerekenler: [Node.js](https://nodejs.org) 18 veya üstü, sunumları yayına almak için ücretsiz bir
[Cloudflare](https://dash.cloudflare.com/sign-up) hesabı, rehberli yol için [Claude Code](https://claude.com/claude-code).

## Claude Code ile hızlı başlangıç (önerilen)

```
/plugin marketplace add radioheavy/show-of-phones
/plugin install show-of-phones@show-of-phones
```
Sonra `/show-of-phones` yaz ya da sadece *“etkileşimli bir sunum yapmama yardım et”* de. Claude
konunu, salonunu ve hikâyeni sorar, taslağı erkenden gösterir, canlı anları yerleştirir, yayınlar ve
sana mekân kontrol listesini verir.

## Elle

```bash
git clone https://github.com/radioheavy/show-of-phones
cd show-of-phones && npm install
npm run sop new benim-sunumum "Benim sunumum"   # talks/benim-sunumum/ oluşur
npm run dev                                      # canlı katmanla yerelde çalışır
```

`talks/benim-sunumum/talk.json` içinde `"lang": "tr"` yap, `slides.html` dosyasını düzenle. Canlı oylama tek satır:

```html
<div class="sop-poll" data-step="1" data-close="2"
     data-q="Şu an neredesin?" data-options="Ön sıra|Arka sıra|Evde"></div>
```

Format belgesi: [docs/FORMAT.md](docs/FORMAT.md). Kendi tasarımın için: [docs/THEMES.md](docs/THEMES.md) (tek tema sunumu, telefonları ve kumandayı birlikte giydirir). Örnek: [talks/merhaba-salon](talks/merhaba-salon) (Türkçe) ve [talks/hello-world](talks/hello-world) (İngilizce).

### Yayına almak (ücretsiz Cloudflare planı yeter)

```bash
npx wrangler login                          # bir kez: tarayıcını açar
npm run sop -- cloud --name=benim-sunumlar  # bir ad seç; giriş, hesap ve adın boş olduğu kontrol edilir
npm run deploy                              # ilk seferde admin anahtarı oluşur (.sop/admin.key) ve yüklenir
npm run sop open benim-sunumum              # sunumu anahtarla açar (canlı katman açık)
npm run sop remote benim-sunumum            # telefon kumandası QR'ı. Anahtar içerir: asla yansıtma.
```

Eksik olanı her an `npm run sop cloud` söyler. Ücretsiz bir `benim-sunumlar.<sen>.workers.dev` adresi alırsın;
kendi alan adın için (DNS bölgesi aynı hesapta olmalı): `npm run sop -- cloud --domain=sunum.ornek.com`.
Aynı adlı ama senin klasöründen yapılmamış bir yayının üzerine yazmayı reddeder.
Kök adres sunumlarını listeler; `_` ile başlayan klasörler (`_template` gibi) hiç yayınlanmaz, örnek
sunumları yayında istemiyorsan `hello-world` ve `merhaba-salon` klasörlerinin adının başına `_` koy.

### Mekânda

Herhangi bir bilgisayarda (kurulum yok, sahnede şifre yazmak yok):

1. `https://alan-adin/benim-sunumum/baglan` aç (ya da `/pair`): 6 haneli kod çıkar.
2. Telefondaki kumandada **📺 Ekran bağla**’ya dokun, kodu yaz.
3. **F** ile tam ekran. Bitti. Bağlantı 12 saat geçerli, sayfa yenilense de kalır.

İnternet yoksa sunum yine çalışır, canlı kısımlar kenara çekilir.

## İçinde ne var?

| | |
|---|---|
| `engine/` | sunum motoru, telefon sayfası, kumanda, temalar, TR/EN metinler (düz JS, derleme adımı yok) |
| `worker/` | Cloudflare Worker + her sunuma bir Durable Object odası (oylar, dokunuşlar, eşleşme, kumanda komutları) |
| `cli/sop.mjs` | `new`, `dev`, `cloud`, `deploy`, `open`, `remote`, `key`, `check`, `build` |
| `talks/` | sunumların (`_template`, örnekler `hello-world` ve `merhaba-salon`) |
| `site/` | isteğe bağlı: kökte yayınlanan kendi tanıtım sayfan (oluştur ya da `sop.config.local.json` içinde `"site"` ile başka klasörü göster) |
| `plugin/` | Claude Code eklentisi ve skill |

Canlı parçalar: **oylama** (2–6 seçenek), **kaydırma** (tek kart, iki taraf), **dokunma yarışı**, **katılım**
(QR + sayaç), **sonuçlar** (salonun karnesi). Mekân için: eşleşme kodu, yenilemede kaldığı yerden devam,
internetsiz çalışma, dikey ve yatay düzen, kumanda telefonu uyutmaz, eski kumanda komutları tekrar oynatılmaz.

## Nereden çıktı?

Show of Phones, Claude Game Jam’de (İstanbul, 21.11.2026) yapay zekâyla üç iPhone oyunu yapmayı
anlatan on dakikalık **OKTAY.EXE** sunumu olarak doğdu. Salon bir asansörde hayatta kalmaya çalıştı,
1956’dan bir kart kaydırdı, minik bir yapay zekâyı dokunuşlarıyla besledi. İnsanlar “aynısını nasıl
yaparım?” diye sordu: işte o, temizlendi ve herkese açıldı. Orijinal sunum: https://jam.oktaydak.com

## Ajanlar için

Kod yazan ajanlar [AGENTS.md](AGENTS.md) dosyasını okur (Claude Code onu `CLAUDE.md` üzerinden alır). Dil
modelleri için dizin [llms.txt](llms.txt) dosyasında; landing'de de https://showofphones.oktaydak.com/llms.txt
ve https://showofphones.oktaydak.com/for-agents adreslerinde var.

## Katkı

Yeni parçalar (bilgi yarışması, kelime bulutu, soru-cevap), diller (`engine/i18n.js`) ve temalar çok
makbule geçer. Motor bağımlılıksız, sunum formatı düz HTML kalsın.

MIT Lisansı.

# ARC Vault Harvester for Windows

Windows arka plan uygulaması. Steam'de o an girişli hesabı izler; hesap
değiştiğinde çalışan Steam istemcisinden taze bir Embark token üretip ARC Vault
API'ye gönderir.

> Not: Oyunun "Frozen Trail" güncellemesinden sonra token artık Windows
> Credential Manager'a yazılmıyor. Bu sürüm (v3) token'ı doğrudan Steam istemci
> bileti (Steamworks web-api ticket) ile Embark'tan üretir; Credential Manager
> okuması bırakılmıştır. Yalnızca Steam desteklenir (Xbox tarafı beklemede).

## Özellikler

- System tray'de çalışır; Steam girişli hesabını izler (registry `ActiveUser`).
- Hesap değişince otomatik mint + push. Oyun açıkken mint ertelenir (çakışma önlemi).
- Mint, kısa ömürlü bir alt süreçte (`mint` alt-komutu) izole edilir.
- Windows açıldığında otomatik başlatılabilir.
- API key Windows Credential Manager'da saklanır.
- Token değerlerini loglamaz; her adım ayrıntılı loglanır (teşhis için).
- Log/config dosyaları `%LOCALAPPDATA%\ARC Vault Harvester` altındadır.

## Gereksinim: steam_api64.dll

Mint, `steam_api64.dll` ister. `build.ps1` bunu kurulu ARC Raiders (Steam) klasöründen
otomatik kopyalayıp exe'ye paketler; bulunamazsa hata verir (DLL'i bu klasöre elle
kopyalayın). Çalışma anında DLL exe'nin yanında (bundle), yoksa `ARC_STEAM_DLL` ortam
değişkenindeki yolda, yoksa bilinen oyun kurulum yollarında aranır.

## Geliştirme Ortamında Çalıştırma

```powershell
cd tools\windows_harvester
python -m pip install -r requirements.txt
python .\arc_vault_harvester.py configure --api-key "<INTERNAL_API_KEY>" --autostart
python .\arc_vault_harvester.py
```

## Exe Build

```powershell
cd tools\windows_harvester
.\build.ps1
```

Build çıktısı:

```text
tools\windows_harvester\dist\ARC Vault Harvester.exe
tools\windows_harvester\dist\ARC Vault Harvester CLI.exe
tools\windows_harvester\installer\ARC-Vault-Harvester-Setup.exe
```

Installer üretimi için Inno Setup 6 gerekir. Kurulu değilse build scripti exe'leri
üretir, installer adımını atlar.

```powershell
winget install JRSoftware.InnoSetup
```

Sadece portable exe üretmek için:

```powershell
.\build.ps1 -SkipInstaller
```

İlk kurulum:

```powershell
& ".\dist\ARC Vault Harvester.exe" configure --api-key "<INTERNAL_API_KEY>" --autostart
& ".\dist\ARC Vault Harvester.exe"
```

API key verilmeden uygulama ilk kez açılırsa kurulum penceresi açılır ve key'i
ister. Key Windows Credential Manager ve DPAPI fallback ile saklanır.

API key'i daha sonra değiştirmek için tray menüsünden `API Key Güncelle` seçin
veya:

```powershell
& ".\dist\ARC Vault Harvester CLI.exe" configure --prompt-api-key --show-existing
```

`configure` komutu uygulamayı başlatmaz; sadece API key/config/autostart ayarını
yazar. Tray icon görmek için exe'yi parametresiz çalıştırın.

Durum kontrolü:

```powershell
& ".\dist\ARC Vault Harvester CLI.exe" status
```

Debug/console modunda çalıştırma:

```powershell
& ".\dist\ARC Vault Harvester CLI.exe" --no-tray
```

Normal exe `--windowed` build edildiği için `status` çıktısını popup olarak gösterir.
Console çıktısı görmek için `ARC Vault Harvester CLI.exe` kullanın.

## Çalışma Mantığı

1. Tray süreci, girişli Steam hesabını `HKCU\Software\Valve\Steam\ActiveProcess\ActiveUser`
   üzerinden izler (hafif, saniyede bir okuma değil; `poll_interval`).
2. Hesap değişince (ve oyun kapalıysa) kısa ömürlü bir `mint` alt süreci başlatılır.
3. Mint: Steamworks `GetAuthTicketForWebApi` (identity `embark-auth`, app 1808500) ile
   web-api bileti alınır, Embark `oauth2/token` (client_credentials) ile access token üretilir.
4. Üretilen token `/api/accounts/token-push`'a gönderilir; API hesap eşleştirme, arctracker
   bridge ve sync işlerini yapar.
5. API tokenı hesaba eşleştiremezse pending olarak saklanır; uygulama bunu başarı kabul eder.
6. Oyun (`PioneerGame.exe`) çalışıyorsa mint ertelenir; denemeler backoff ile tekrarlanır.
   Aynı hesap için token ~20 saat sonra yeniden mint edilir (token ~24 saat geçerli).

Tray menüsündeki **Simdi Guncelle** ile o an girişli hesap için elle mint tetiklenebilir.
CLI'da tek seferlik mint: `... mint`.

## Notlar

- Token aynı anda yalnızca o an Steam'de girişli hesap için üretilebilir; birden çok
  hesap için Steam oturumunu değiştirmek gerekir (bu zaten günlük kullanım akışıdır).
- Ard arda hızlı mint Steam IPC'sini bozabildiğinden mint hesap-değişiminde/backoff ile
  tetiklenir, sürekli döngüde değil.
- Xbox hesapları: oyunun paket-kimlikli helper'ı gerektiğinden bu sürümde otomatik
  desteklenmiyor; o hesaplar için resmî ARC Tracker Link kullanılabilir.

## Yeni Sürüm Yayınlama

1. `arc_vault_harvester.py` içindeki `CURRENT_VERSION` değerini artırın (ör. `2.2.0`).
2. Commit'leyip aynı sürümle tag push edin: `git tag v2.2.0 && git push origin v2.2.0`.
3. GitHub Actions exe'leri ve kurulumu derleyip release'e yükler.

API sürümü GitHub'daki son release'ten okur (10 dakika önbellek), API tarafında değişiklik
gerekmez. Release, hem `ARC.Vault.Harvester.exe` hem `ARC-Vault-Harvester-Setup.exe`
yüklenene kadar dikkate alınmaz. Kurulu uygulamalar 6 saat içinde yeni sürümü görür ve
yüklemek için onay ister.

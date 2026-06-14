# ARC Vault Harvester for Windows

Windows arka plan uygulaması. Credential Manager içindeki Embark JWT'leri izler,
yeni token gördüğünde ARC Vault API'ye gönderir.

## Özellikler

- System tray'de çalışır.
- Windows açıldığında otomatik başlatılabilir.
- API key Windows Credential Manager'da saklanır.
- Token değerlerini loglamaz.
- Aynı token expiry daha önce gönderildiyse tekrar push etmez.
- Log/state/config dosyaları `%LOCALAPPDATA%\ARC Vault Harvester` altındadır.

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

1. `EmbarkID/embark-pioneer/` ve `EmbarkID/embark-pioneer/pioneer-live`
   Credential Manager kayıtları okunur.
2. Geçerli JWT bulunursa `sub` ve `exp` bilgisi çıkarılır.
3. Aynı `sub + exp` daha önce gönderilmediyse token API'ye push edilir.
4. API hesap eşleştirme, arctracker bridge ve sync işlerini yapar.
5. API tokenı hesaba eşleştiremezse token admin panelinde pending olarak saklanır.
   Uygulama bu cevabı "kaydedildi" kabul eder ve aynı token expiry'yi tekrar tekrar
   göndermeyi bırakır.

## Notlar

- Bu uygulama token üretmez; oyun/launcher token yazdığı anda yakalar.
- Servis olarak değil, kullanıcı oturumunda tray app olarak çalışması daha uygun.
  Credential Manager kayıtları ve oyun oturumu kullanıcı profiline bağlıdır.
- Gerçek Windows servis modeli istenirse ayrı bir servis wrapper gerekir, ama tray app
  bu kullanım için daha az sorunlu ve daha görünürdür.

# ARC Vault

ARC Vault, ARC Raiders hesaplarını tek bir panelden takip etmek için geliştirilmiş çok hesaplı envanter ve ilerleme yönetim aracıdır. Proje, arctracker.io üzerindeki hesap verilerini kullanır ve arctracker deneyiminin üzerine çıkarak birden fazla hesabın envanterini, projelerini, görevlerini, hideout durumunu, blueprint bilgisini ve token durumunu tek merkezden yönetilebilir hale getirir.

## Ne İşe Yarar?

ARC Vault özellikle birden fazla ARC Raiders hesabı yöneten kullanıcılar için tasarlandı.

- Birden fazla arctracker hesabını tek panelde listeler.
- Her hesap için envanter, ekonomi, görevler, projeler, blueprintler ve hideout ilerlemesini gösterir.
- Hesaplar arasında hızlı geçiş, global arama ve toplu sync akışı sunar.
- Arctracker'a bağlanmış hesaplardan verileri senkronize eder.
- Windows harvester uygulaması ile oyunun Windows Credential Manager'a yazdığı Embark tokenlarını yakalayıp backend'e iletir.
- Admin panelinde eşleşmeyen tokenları doğru hesaba bağlama akışı sağlar.

## Arctracker İle İlişki

Bu proje arctracker.io verisini temel alır. ARC Vault, arctracker'ın yerine geçmekten çok, arctracker üzerinde bulunan hesap verilerini çok hesaplı bir yönetim katmanına taşır.

Arctracker tarafında tek tek hesap bazında görülen bilgiler ARC Vault içinde merkezi bir arayüzde toplanır. Böylece farklı hesapların:

- Envanteri
- Para ve XP bilgileri
- Görev ilerlemeleri
- Proje ilerlemeleri
- Hideout durumu
- Blueprint ve mod bilgileri
- Token geçerlilik durumu

tek ekrandan takip edilebilir.

## Proje Yapısı

```text
.
├── api/                    # FastAPI backend
├── web/                    # Next.js frontend
├── tools/                  # Harvester ve yardımcı araçlar
├── data/                   # Referans oyun verileri
├── design/                 # Tasarım referansları
├── docker-compose.yml      # Lokal geliştirme compose dosyası
└── .github/workflows/ci.yml
```

## Backend

Backend FastAPI ile yazılmıştır.

Ana görevleri:

- Kullanıcı ve admin auth akışı
- Arctracker hesaplarını kayıt altına alma
- Arctracker verilerini sync etme
- Referans oyun verilerini sunma
- Harvester'dan gelen Embark tokenlarını doğrulama ve ilgili hesaba bağlama
- Eşleşmeyen tokenları admin panelinde bekleyen listeye alma
- Hesap credentiallarını encrypted olarak saklama

Önemli endpoint grupları:

- `/health`
- `/api/auth/*`
- `/api/accounts/*`
- `/api/sync/*`
- `/api/reference/*`

## Frontend

Frontend Next.js ile yazılmıştır.

Başlıca ekranlar:

- Ana hesap listesi
- Dashboard
- Inventory
- Quests
- Projects
- Hideout
- Blueprints
- Settings
- Admin kullanıcı yönetimi
- Admin token eşleştirme paneli

Frontend artık Xbox bilgisi veya manuel refresh token akışı istemez. Hesap ekleme için arctracker e-posta ve şifre bilgisi yeterlidir.

## Windows Harvester

`tools/windows_harvester` altında Windows için tray uygulaması bulunur.

Harvester'ın görevi:

1. Windows Credential Manager içindeki Embark/Pioneer token kayıtlarını izler.
2. Yeni veya daha güncel token gördüğünde ARC Vault API'ye gönderir.
3. Aynı token expiry değerini tekrar tekrar göndermemek için lokal state tutar.
4. API bir hesabı eşleştiremezse token backend'de pending olarak saklanır.
5. Admin daha sonra web panelinden pending tokenı doğru hesaba bağlayabilir.

Harvester API key'i Windows Credential Manager veya DPAPI fallback ile saklar. Loglarda JWT veya API key yazılmaz.

## Lokal Geliştirme

### API

```bash
cd api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
uvicorn app.main:app --reload
```

Örnek env için:

```bash
cp api/.env.example api/.env
```

Gerekli temel değişkenler:

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/account_tracker
JWT_SECRET=change-me
ENCRYPTION_KEY=
INTERNAL_API_KEY=
AUTO_REFRESH_ENABLED=false
CORS_ORIGINS=*
```

### Web

```bash
cd web
npm ci
npm test
npm run typecheck
npm run dev
```

## Docker

Lokal geliştirme için:

```bash
docker compose up --build
```

Production deploy akışı GitHub Actions üzerinden çalışır. Image'lar GitHub runner üzerinde build edilir, `arc-vault-api:latest` ve `arc-vault-web:latest` olarak paketlenir, sunucuya `scp` ile gönderilir ve sunucuda `docker load` ile içeri alınır.

Bu akışta sunucuda Docker build yapılmaz. Sunucu sadece hazır image'ı yükler ve compose servislerini yeniden başlatır.

## CI/CD

`.github/workflows/ci.yml` şu adımları çalıştırır:

1. API testleri
2. Web testleri
3. Web typecheck
4. API Docker image build
5. Web Docker image build
6. Trivy ile image güvenlik taraması
7. Push main branch'e yapılmışsa image tar dosyalarını sunucuya kopyalama
8. Sunucuda `docker load`
9. `docker compose up -d --no-build api web`
10. Health check

Gerekli GitHub Actions secrets:

- `SSH_PRIVATE_KEY`
- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_PATH`

Sunucudaki compose dosyasında beklenen servisler:

- `api`
- `web`
- `postgres`

Beklenen image isimleri:

- `arc-vault-api:latest`
- `arc-vault-web:latest`

## Güvenlik Notları

- Gerçek `.env` dosyaları commit edilmemelidir.
- `INTERNAL_API_KEY`, harvester ile backend arasındaki token push endpointini korur.
- Arctracker şifreleri ve Embark tokenları backend tarafında encrypted olarak saklanır.
- Harvester logları JWT veya API key yazmaz.
- Admin olmayan kullanıcılar pending token eşleştirme ekranını göremez.
- Public repo öncesinde GitHub secret değerleri, canlı admin şifresi ve daha önce paylaşılmış anahtarlar rotate edilmelidir.

## Testler

API:

```bash
cd api
pytest
```

Web:

```bash
cd web
npm test
npm run typecheck
```

Security audit:

```bash
cd web
npm audit --omit=dev

cd ../api
python -m pip_audit -r requirements.txt -r requirements-dev.txt
```

## Lisans ve Veri Kaynakları

Bu repo ARC Vault uygulama kodunu içerir. Oyun referans verileri ve arctracker.io üzerinden elde edilen veriler ilgili kaynakların şartlarına tabi olabilir. Public kullanımda bu veri kaynaklarının lisans ve kullanım şartları ayrıca değerlendirilmelidir.

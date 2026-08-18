# ARC Vault

ARC Vault is a multi-account inventory and progression management tool for ARC Raiders. It uses account data from arctracker.io and builds an additional management layer on top of arctracker, making it possible to track multiple accounts from one central dashboard.

With ARC Vault, you can manage multiple accounts' inventories, projects, quests, hideout progress, blueprints, economy data, and token status in one place.

## What It Does

ARC Vault is designed for users who manage more than one ARC Raiders account.

- Lists multiple arctracker accounts in a single dashboard.
- Shows inventory, economy, quests, projects, blueprints, and hideout progress per account.
- Provides quick account switching, global search, and bulk sync workflows.
- Syncs data from accounts connected to arctracker.
- Uses a Windows harvester app to detect Embark tokens written by the game to Windows Credential Manager and push them to the backend.
- Provides an admin-only flow for matching unknown harvested tokens to the correct account.

## Relationship With Arctracker

ARC Vault is built on top of arctracker.io data. It does not aim to replace arctracker. Instead, it extends the arctracker experience with a multi-account management layer.

Information that is normally viewed one account at a time on arctracker can be collected and managed centrally in ARC Vault, including:

- Inventory
- Currency and XP
- Quest progress
- Project progress
- Hideout status
- Blueprint and mod data
- Token validity status

## Project Structure

```text
.
├── api/                    # FastAPI backend
├── web/                    # Next.js frontend
├── tools/                  # Harvester and helper tools
├── data/                   # Reference game data
├── design/                 # Design references
├── docker-compose.yml      # Local development compose file
└── .github/workflows/ci.yml
```

## Backend

The backend is built with FastAPI.

Main responsibilities:

- User and admin authentication
- Arctracker account registration
- Arctracker data sync
- Reference game data APIs
- Embark token ingestion from the harvester
- Matching harvested tokens to accounts
- Storing unmatched tokens in a pending admin queue
- Encrypting stored account credentials

Important endpoint groups:

- `/health`
- `/api/auth/*`
- `/api/accounts/*`
- `/api/sync/*`
- `/api/reference/*`

## Frontend

The frontend is built with Next.js.

Main screens:

- Account home
- Dashboard
- Inventory
- Quests
- Projects
- Hideout
- Blueprints
- Settings
- Admin user management
- Admin token matching panel

The frontend no longer requires Xbox credentials or a manual refresh-token flow. Adding an account only requires arctracker email and password.

## Windows Harvester

The Windows tray app lives under `tools/windows_harvester`.

The harvester:

1. Watches Embark/Pioneer token entries in Windows Credential Manager.
2. Sends newly detected or newer tokens to the ARC Vault API.
3. Keeps local state so the same token expiry is not pushed repeatedly.
4. Lets the backend store unmatched tokens as pending records.
5. Lets an admin assign pending tokens to the correct account from the web UI.

The harvester stores the API key in Windows Credential Manager, with a DPAPI-encrypted fallback. It does not log JWTs or API keys.

## Local Development

### API

```bash
cd api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
uvicorn app.main:app --reload
```

Create a local env file from the example:

```bash
cp api/.env.example api/.env
```

Core environment variables:

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/account_tracker
JWT_SECRET=
ENCRYPTION_KEY=
INTERNAL_API_KEY=
AUTO_REFRESH_ENABLED=false
CORS_ORIGINS=*
```

`JWT_SECRET` is required and must be at least 32 characters — the API refuses to
start otherwise. Generate one with `openssl rand -hex 32`.

Sessions use a 30-minute access token plus a rotating refresh token stored in the
`refresh_tokens` table (30-day lifetime). The web client refreshes silently on 401,
so an active user is never logged out mid-session. Changing `JWT_SECRET` or a user's
password/role invalidates every existing session for that user.

### Web

```bash
cd web
npm ci
npm test
npm run typecheck
npm run dev
```

## Docker

For local development:

```bash
docker compose up --build
```

The production deploy flow runs through GitHub Actions. Images are built on the GitHub runner, packaged as `arc-vault-api:latest` and `arc-vault-web:latest`, copied to the server with `scp`, and loaded on the server with `docker load`.

The server does not build Docker images in this flow. It only loads prebuilt images and restarts the compose services.

## CI/CD

`.github/workflows/ci.yml` runs:

1. API tests
2. Web tests
3. Web typecheck
4. API Docker image build
5. Web Docker image build
6. Trivy image security scans
7. Image artifact upload
8. Deploy on pushes to `main`
9. Server-side `docker load`
10. `docker compose up -d --no-build api web`
11. Health check

Required GitHub Actions secrets:

- `SSH_PRIVATE_KEY`
- `SERVER_HOST`
- `SERVER_USER`
- `SERVER_PATH`

Expected services in the server compose file:

- `api`
- `web`
- `postgres`

Expected image names:

- `arc-vault-api:latest`
- `arc-vault-web:latest`

## Security Notes

- Real `.env` files must never be committed.
- `INTERNAL_API_KEY` protects the token-push endpoint used by harvesters.
- Arctracker passwords and Embark tokens are encrypted at rest in the backend.
- Harvester logs do not include JWTs or API keys.
- Only admins can view and assign pending tokens.
- Before making the repository public, rotate any secrets that may have been shared outside the repository, including GitHub secrets, admin passwords, SSH keys, and internal API keys.

## Tests

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

## License and Data Sources

This repository contains the ARC Vault application code. Reference game data and data obtained through arctracker.io may be subject to the terms of their respective sources. Review those terms before using this repository publicly.

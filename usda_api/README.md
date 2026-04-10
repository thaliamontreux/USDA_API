# USDA API (Node.js)

Node.js API for the USDA FoodData Central MySQL dataset.

- Runs on Ubuntu 24.04
- Connects to MySQL via Unix socket or TCP
- Internet-exposed friendly:
  - API key authentication (two-key rotation)
  - Admin control panel for key management
  - Admin forced password change on first login
  - MFA support: TOTP + Passkeys/Security Keys (WebAuthn)

## Quick start (local/dev)

```bash
cd usda_api
npm install
cp .env.example .env
npm start
```

## One-command install (Ubuntu 24.04 bare server)

From the repo root on Ubuntu:

```bash
sudo ./install_ubuntu_24_04.sh
```

It will:

- Install MySQL + Node + Python via `apt`
- Configure MySQL to listen on `127.0.0.1`
- Prompt you for the USDA dataset ZIP URL (from https://fdc.nal.usda.gov/download-datasets)
- Import the dataset (skips if already imported unless `--force-rebuild-database`)
- Install and start the API as a `systemd` service

Open:

- Admin UI: `http://127.0.0.1:8080/admin`
- Health: `http://127.0.0.1:8080/health`

## Admin login & security flow

On first run, the admin account is bootstrapped as:

- Username: `admin`
- Password: `admin`

You must:

1. Log in
2. **Change the password** (required before continuing)
3. Configure MFA:
   - TOTP (Authenticator app), and/or
   - Passkeys/Security keys (WebAuthn)

Only after those steps can you manage API keys.

## Using the API

All `/api/v1/*` endpoints require an API key.

Send either header:

- `x-api-key: <key>`
- `Authorization: Bearer <key>`

Example:

```bash
curl -H "x-api-key: YOUR_KEY" \
  "https://usfooddb.translife.online/api/v1/foods/search?q=apple&limit=5"
```

## Docs

- Deployment (Ubuntu 24.04 + Nginx + Cloudflare Origin Cert): `DEPLOY_UBUNTU_24_04.md`
- Admin panel + MFA: `docs/ADMIN_PANEL.md`
- API usage examples: `docs/USAGE.md`
- API technical reference: `docs/API_REFERENCE.md`

## API endpoints

- `GET /health`
- `GET /api/v1/foods/search?q=...&limit=...&offset=...&dataType=...`
- `GET /api/v1/foods/:fdcId`
- `GET /api/v1/foods/:fdcId/nutrients?limit=...&minAmount=...`
- `GET /api/v1/nutrients/search?q=...&limit=...`
- `GET /api/v1/branded/search?upc=...&brandOwner=...&ingredients=...`
- `GET /api/v1/branded/:fdcId`

## Notes

- Keep `.env` private. Don’t commit it.
- The `data/` directory stores:
  - API key hashes: `keys.json`
  - Admin user store: `admin_users.json`


# USDA API deployment (Ubuntu 24.04 + HTTPS)

This guide deploys `usda_api` on Ubuntu 24.04 behind **Nginx + HTTPS**.

If you want a fully automated "bare server" setup (APT installs + MySQL + dataset download/import + systemd service), use the installer script in the repo:

```bash
sudo ./install_ubuntu_24_04.sh
```

## 0) Prereqs

- Node.js 18+ (22 is fine)
- MySQL reachable either via **Unix socket** (local MySQL) or TCP (remote MySQL)
- A DNS name pointing at the server: `usfooddb.translife.online`

Cloudflare:

- Create an `A`/`AAAA` record for `usfooddb.translife.online` pointing to your server
- Keep it **Proxied** (orange cloud)
- Set **SSL/TLS mode** to **Full (strict)**

## 1) Create a Linux user and install the app

- Put the code in a service directory (example):

```bash
sudo mkdir -p /opt/usda_api
sudo chown -R $USER:$USER /opt/usda_api
# copy your project into /opt/usda_api (rsync/scp/git)
```

Install dependencies:

```bash
cd /opt/usda_api
npm ci || npm install
```

## 2) Create environment file

Create `/opt/usda_api/.env`:

```bash
PORT=8080
BIND_HOST=127.0.0.1

DB_NAME=usdafooddb
DB_USER=foodie
DB_PASSWORD=YOUR_DB_PASSWORD

# If MySQL is local on this box:
DB_CONNECT_MODE=socket
DB_SOCKET_PATH=/var/run/mysqld/mysqld.sock

# If MySQL is remote instead, use TCP:
# DB_CONNECT_MODE=tcp
# DB_HOST=192.168.250.212
# DB_PORT=3306

SQL_HISTORY_MAX=200

# API key + admin UI
KEYSTORE_PATH=./data/keys.json
ADMIN_STORE_PATH=./data/admin_users.json
SESSION_SECRET=CHANGE_ME_TO_LONG_RANDOM
SESSION_COOKIE_SECURE=1

# Passkeys (WebAuthn) must match your public HTTPS URL
RP_ID=usfooddb.translife.online
ORIGIN=https://usfooddb.translife.online
RP_NAME=USDA API
```

### Admin login + forced password change + MFA

On first run, the admin account is bootstrapped as:

- Username: `admin`
- Password: `admin`

After you log in, you are **forced to change the password** before you can manage API keys.

You must also configure at least one MFA factor:

- **TOTP** (authenticator app)
- **Passkeys / Security keys** (WebAuthn)

## 3) Key store permissions

Keys are stored hashed at `./data/keys.json` relative to the app root.

Recommended:

```bash
cd /opt/usda_api
mkdir -p data
chmod 700 data
# keys.json will be created automatically on first start
```

## 4) systemd service

Create `/etc/systemd/system/usda_api.service`:

```ini
[Unit]
Description=USDA API (Node.js)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/usda_api
EnvironmentFile=/opt/usda_api/.env
ExecStart=/usr/bin/node /opt/usda_api/src/server.js
Restart=on-failure
RestartSec=3

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/usda_api/data

# If using MySQL socket, the service user must be able to read the socket.
# Often the socket is readable by the mysql group.

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now usda_api
sudo systemctl status usda_api
journalctl -u usda_api -f
```

On first start, the server prints bootstrap API keys (key1/key2) to logs once:

```bash
journalctl -u usda_api -n 200 --no-pager
```

## 5) Nginx reverse proxy + HTTPS (Cloudflare Origin Certificate)

Install Nginx:

```bash
sudo apt update
sudo apt install -y nginx
```

### 5.1) Create a Cloudflare Origin Certificate

In Cloudflare:

- Go to **SSL/TLS**
- Set mode to **Full (strict)**
- Go to **Origin Server** -> **Create Certificate**
- Hostnames:
  - `usfooddb.translife.online`
- Key type: RSA (default) is fine
- Validity: pick your preference (e.g. 15 years)

Download:

- The **Origin Certificate** (PEM)
- The **Private Key** (PEM)

On Ubuntu, place them here:

```bash
sudo mkdir -p /etc/ssl/cf-origin
sudo nano /etc/ssl/cf-origin/usfooddb.translife.online.pem
sudo nano /etc/ssl/cf-origin/usfooddb.translife.online.key

sudo chmod 600 /etc/ssl/cf-origin/usfooddb.translife.online.key
sudo chmod 644 /etc/ssl/cf-origin/usfooddb.translife.online.pem
```

### 5.2) Nginx site

Create `/etc/nginx/sites-available/usda_api`:

```nginx
server {
  listen 80;
  server_name usfooddb.translife.online;

  location / {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name usfooddb.translife.online;

  # Cloudflare Origin Certificate (recommended with Cloudflare proxy)
  ssl_certificate /etc/ssl/cf-origin/usfooddb.translife.online.pem;
  ssl_certificate_key /etc/ssl/cf-origin/usfooddb.translife.online.key;

  # basic security headers
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy no-referrer always;

  client_max_body_size 2m;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_read_timeout 60s;
  }
}
```

Enable:

```bash
sudo ln -s /etc/nginx/sites-available/usda_api /etc/nginx/sites-enabled/usda_api
sudo nginx -t
sudo systemctl reload nginx
```

## 6) Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## 7) Verify

- `https://usfooddb.translife.online/health`
- `https://usfooddb.translife.online/admin`

Admin workflow:

- Login: `admin` / `admin`
- Change password when prompted
- Set up MFA (TOTP and/or Passkey)

API requests require a key:

```bash
curl -H "x-api-key: YOUR_KEY" "https://usfooddb.translife.online/api/v1/foods/search?q=apple&limit=5"
```

## Notes

- Keep `/health` public for monitoring.
- Keep `/admin` protected with a strong admin password and HTTPS.
- Consider restricting `/admin` by IP allowlist in Nginx if possible.

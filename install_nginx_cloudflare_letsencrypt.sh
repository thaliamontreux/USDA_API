#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-0} -ne 0 ]]; then
  echo "Please run as root (use sudo)." >&2
  exit 1
fi

say() { echo "[nginx+letsencrypt] $*"; }

DEFAULT_DOMAIN="usfooddb.translife.online"
DEFAULT_UPSTREAM_HOST="127.0.0.1"
DEFAULT_UPSTREAM_PORT="8080"

DOMAIN="${DOMAIN:-$DEFAULT_DOMAIN}"
UPSTREAM_HOST="${UPSTREAM_HOST:-$DEFAULT_UPSTREAM_HOST}"
UPSTREAM_PORT="${UPSTREAM_PORT:-$DEFAULT_UPSTREAM_PORT}"

read -r -p "Domain name [${DOMAIN}]: " DOMAIN_IN
if [[ -n "${DOMAIN_IN:-}" ]]; then
  DOMAIN="$DOMAIN_IN"
fi

read -r -p "Upstream host [${UPSTREAM_HOST}]: " UPSTREAM_HOST_IN
if [[ -n "${UPSTREAM_HOST_IN:-}" ]]; then
  UPSTREAM_HOST="$UPSTREAM_HOST_IN"
fi

read -r -p "Upstream port [${UPSTREAM_PORT}]: " UPSTREAM_PORT_IN
if [[ -n "${UPSTREAM_PORT_IN:-}" ]]; then
  UPSTREAM_PORT="$UPSTREAM_PORT_IN"
fi

EMAIL="${LETSENCRYPT_EMAIL:-}" 
if [[ -z "${EMAIL}" ]]; then
  read -r -p "Let's Encrypt email (required for registration/expiry notices): " EMAIL
fi
if [[ -z "${EMAIL}" ]]; then
  echo "Email is required." >&2
  exit 1
fi

CF_CREDS_FILE="/etc/letsencrypt/cloudflare.ini"

if [[ -f "$CF_CREDS_FILE" ]]; then
  say "Found existing Cloudflare credentials at $CF_CREDS_FILE (will reuse)."
else
  echo
  echo "Cloudflare API token"
  echo "- Recommended: a scoped API token with permissions: Zone:DNS:Edit for the zone that contains ${DOMAIN}"
  echo
  read -r -s -p "Cloudflare API token: " CF_TOKEN
  echo
  if [[ -z "${CF_TOKEN:-}" ]]; then
    echo "Cloudflare API token is required." >&2
    exit 1
  fi

  mkdir -p /etc/letsencrypt
  cat > "$CF_CREDS_FILE" <<EOF
# Cloudflare API token used by certbot DNS-01 renewals
# File must be root-only (0600)
dns_cloudflare_api_token = ${CF_TOKEN}
EOF
  chmod 600 "$CF_CREDS_FILE"
fi

say "Installing packages (nginx + certbot + Cloudflare DNS plugin)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends nginx certbot python3-certbot-dns-cloudflare

NGINX_SITE_NAME="usda_api"
NGINX_AVAIL="/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf"

UPSTREAM_URL="http://${UPSTREAM_HOST}:${UPSTREAM_PORT}"

write_http_only_conf() {
  cat > "$NGINX_AVAIL" <<EOF
server {
  listen 80;
  server_name ${DOMAIN};

  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy no-referrer always;

  client_max_body_size 2m;

  location / {
    proxy_pass ${UPSTREAM_URL};
    proxy_http_version 1.1;

    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;

    proxy_read_timeout 60s;
  }
}
EOF
}

write_https_conf() {
  cat > "$NGINX_AVAIL" <<EOF
server {
  listen 80;
  server_name ${DOMAIN};

  location / {
    return 301 https://\$host\$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name ${DOMAIN};

  ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers off;

  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy no-referrer always;

  client_max_body_size 2m;

  location / {
    proxy_pass ${UPSTREAM_URL};
    proxy_http_version 1.1;

    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;

    proxy_read_timeout 60s;
  }
}
EOF
}

cert_exists() {
  [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" && -f "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" ]]
}

say "Enabling nginx site..."
ln -sf "$NGINX_AVAIL" "$NGINX_ENABLED"
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi

if cert_exists; then
  say "Existing certificate found for ${DOMAIN}. Writing HTTPS nginx site config..."
  write_https_conf
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
else
  say "No existing certificate found. Writing temporary HTTP-only nginx site config..."
  write_http_only_conf
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx

  say "Requesting Let's Encrypt certificate via Cloudflare DNS-01..."
  certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials "$CF_CREDS_FILE" \
    --preferred-challenges dns \
    -d "$DOMAIN" \
    --agree-tos \
    --non-interactive \
    --email "$EMAIL" \
    --keep-until-expiring

  say "Writing HTTPS nginx site config..."
  write_https_conf
  nginx -t
  systemctl reload nginx
fi

say "Installing certbot deploy hook (reload nginx after renew)..."
HOOK_DIR="/etc/letsencrypt/renewal-hooks/deploy"
HOOK_FILE="${HOOK_DIR}/reload-nginx.sh"
mkdir -p "$HOOK_DIR"
cat > "$HOOK_FILE" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
systemctl reload nginx
EOF
chmod +x "$HOOK_FILE"

say "Done."

echo
echo "HTTPS enabled for: https://${DOMAIN}/"
echo "Nginx config:       ${NGINX_AVAIL}"
echo "Cloudflare creds:   ${CF_CREDS_FILE} (root-only)"
echo

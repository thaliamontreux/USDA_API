#!/usr/bin/env bash
set -euo pipefail

FORCE_REBUILD_DATABASE=0
DATASET_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force-rebuild-database)
      FORCE_REBUILD_DATABASE=1
      shift
      ;;
    --dataset-url)
      DATASET_URL="${2:-}"
      shift 2
      ;;
    --dataset-url=*)
      DATASET_URL="${1#*=}"
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage:
  sudo ./install_ubuntu_24_04.sh [--force-rebuild-database] [--dataset-url <url>]

Installs all dependencies on a bare Ubuntu 24.04 system:
- MySQL server (127.0.0.1)
- Node.js (APT)
- Python3 + mysql connector
- Deploys the USDA Node API as a systemd service
- Optionally downloads a USDA FoodData Central dataset zip and imports it into MySQL

Notes:
- If the database already appears imported, dataset download/import is skipped.
- Use --force-rebuild-database to drop and re-import the database.
- To get a dataset URL, visit: https://fdc.nal.usda.gov/download-datasets
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ${EUID:-0} -ne 0 ]]; then
  echo "Please run as root (use sudo)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

if [[ ! -d "$SCRIPT_DIR/usda_api" ]]; then
  echo "Expected '$SCRIPT_DIR/usda_api' to exist. Run this script from the project root." >&2
  exit 1
fi

if [[ ! -f "$SCRIPT_DIR/import_fdc_to_mysql.py" ]]; then
  echo "Expected '$SCRIPT_DIR/import_fdc_to_mysql.py' to exist. Run this script from the project root." >&2
  exit 1
fi

APP_DIR="/opt/usda_api"
DATASET_WORKDIR="$APP_DIR/dataset"
SYSTEMD_UNIT="/etc/systemd/system/usda_api.service"

DB_HOST="127.0.0.1"
DB_PORT="3306"
DB_NAME="usdafooddb"
DB_USER="foodie"

say() { echo "[install] $*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ensure_env_kv() {
  local file="$1"
  local key="$2"
  local value="$3"

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

mysql_exec_root() {
  mysql -uroot -e "$1"
}

mysql_query_root() {
  mysql -uroot -N -s -e "$1"
}

say "Installing system packages (APT)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  unzip \
  openssl \
  rsync \
  python3 \
  python3-mysql.connector \
  mysql-client \
  mysql-server

say "Ensuring MySQL is running..."
systemctl enable --now mysql

say "Enabling MySQL local_infile..."
cat > /etc/mysql/mysql.conf.d/usda_api.cnf <<'EOF'
[mysqld]
bind-address=127.0.0.1
local_infile=1
EOF
systemctl restart mysql

say "Installing Node.js (APT)..."
if ! need_cmd node; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

say "Creating service user..."
if ! id -u usda_api >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin usda_api
fi

say "Preparing app directory at $APP_DIR..."
mkdir -p "$APP_DIR" "$DATASET_WORKDIR"

say "Deploying application files..."
rsync -a --delete "$SCRIPT_DIR/usda_api/" "$APP_DIR/"
cp -f "$SCRIPT_DIR/import_fdc_to_mysql.py" "$APP_DIR/import_fdc_to_mysql.py"
cp -f "$SCRIPT_DIR/schema.sql" "$APP_DIR/schema.sql"
chown -R usda_api:usda_api "$APP_DIR"

say "Installing Node dependencies..."
cd "$APP_DIR"
if [[ -f package-lock.json ]]; then
  sudo -u usda_api npm ci --omit=dev
else
  sudo -u usda_api npm install --omit=dev
fi

say "Creating MySQL database and user..."
DB_PASSWORD=""
read -r -s -p "MySQL password for app user '${DB_USER}' (leave blank to auto-generate): " DB_PASSWORD
echo
if [[ -z "$DB_PASSWORD" ]]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  say "Generated DB password for '${DB_USER}'. Save this somewhere safe."
fi

mysql_exec_root "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql_exec_root "CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';"
mysql_exec_root "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';"
mysql_exec_root "ALTER USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';"
mysql_exec_root "ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';"
mysql_exec_root "GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';"
mysql_exec_root "GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';"
mysql_exec_root "FLUSH PRIVILEGES;"

say "Writing environment file..."
if [[ ! -f "$APP_DIR/.env" ]]; then
  SESSION_SECRET="$(openssl rand -hex 32)"
  cat > "$APP_DIR/.env" <<EOF
PORT=8080
BIND_HOST=0.0.0.0

DB_CONNECT_MODE=tcp
DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}

SQL_HISTORY_MAX=200

KEYSTORE_PATH=/var/lib/usda_api/keys.json
ADMIN_STORE_PATH=/var/lib/usda_api/admin_users.json
SESSION_SECRET=${SESSION_SECRET}
SESSION_COOKIE_SECURE=0

RP_ID=localhost
ORIGIN=http://localhost:8080
RP_NAME=USDA API
EOF
  chown usda_api:usda_api "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
else
  say "Environment file already exists at $APP_DIR/.env (leaving unchanged)."
fi

ensure_env_kv "$APP_DIR/.env" "KEYSTORE_PATH" "/var/lib/usda_api/keys.json"
ensure_env_kv "$APP_DIR/.env" "ADMIN_STORE_PATH" "/var/lib/usda_api/admin_users.json"

if [[ -f "$APP_DIR/.env" ]]; then
  chown usda_api:usda_api "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

say "Creating systemd service..."
cat > "$SYSTEMD_UNIT" <<'EOF'
[Unit]
Description=USDA API (Node.js)
After=network.target mysql.service
Requires=mysql.service

[Service]
Type=simple
User=usda_api
Group=usda_api
WorkingDirectory=/opt/usda_api
EnvironmentFile=/opt/usda_api/.env
Environment=KEYSTORE_PATH=/var/lib/usda_api/keys.json
Environment=ADMIN_STORE_PATH=/var/lib/usda_api/admin_users.json
StateDirectory=usda_api
StateDirectoryMode=0700
ExecStart=/usr/bin/env node /opt/usda_api/src/server.js
Restart=on-failure
RestartSec=3

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/usda_api

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable usda_api

say "Checking whether database is already imported..."
DB_HAS_ROW=""
set +e
DB_HAS_ROW="$(mysql_query_root "SELECT 1 FROM \`${DB_NAME}\`.food LIMIT 1;" 2>/dev/null)"
set -e

if [[ "$FORCE_REBUILD_DATABASE" -eq 1 ]]; then
  say "--force-rebuild-database specified. Dropping and recreating database..."
  mysql_exec_root "DROP DATABASE IF EXISTS \`${DB_NAME}\`; CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  DB_HAS_ROW=""
fi

if [[ "$DB_HAS_ROW" == "1" ]]; then
  say "Database appears to be already imported (food table has rows). Skipping dataset download/import."
else
  if [[ -z "$DATASET_URL" ]]; then
    echo
    echo "USDA dataset download"
    echo "- Go to: https://fdc.nal.usda.gov/download-datasets"
    echo "- Copy the URL for the FULL dataset ZIP you want"
    echo
    read -r -p "Paste the dataset ZIP URL here (or leave blank to skip import): " DATASET_URL
  fi

  if [[ -z "$DATASET_URL" ]]; then
    say "No dataset URL provided. Skipping dataset import."
  else
    say "Downloading dataset ZIP... (this may take a while)"
    mkdir -p "$DATASET_WORKDIR"
    ZIP_PATH="$DATASET_WORKDIR/fdc_dataset.zip"
    rm -f "$ZIP_PATH"
    curl -L --fail --retry 3 -o "$ZIP_PATH" "$DATASET_URL"

    say "Extracting dataset..."
    EXTRACT_DIR="$DATASET_WORKDIR/extracted"
    rm -rf "$EXTRACT_DIR"
    mkdir -p "$EXTRACT_DIR"
    unzip -q "$ZIP_PATH" -d "$EXTRACT_DIR"

    say "Locating CSV folder..."
    DATASET_DIR=""
    if [[ -f "$EXTRACT_DIR/food.csv" ]]; then
      DATASET_DIR="$EXTRACT_DIR"
    else
      DATASET_DIR="$(find "$EXTRACT_DIR" -maxdepth 4 -type f -name "food.csv" -printf '%h\n' | head -n 1)"
    fi

    if [[ -z "$DATASET_DIR" ]]; then
      echo "Could not locate food.csv inside extracted ZIP. Import cannot continue." >&2
      exit 1
    fi

    say "Importing dataset into MySQL (this can take a long time)..."
    TRUNCATE_FLAG=""
    TABLE_EXISTS=""
    set +e
    TABLE_EXISTS="$(mysql_query_root "SELECT 1 FROM information_schema.tables WHERE table_schema='${DB_NAME}' AND table_name='food' LIMIT 1;" 2>/dev/null)"
    set -e
    if [[ "$TABLE_EXISTS" == "1" ]]; then
      TRUNCATE_FLAG="--truncate"
    fi

    MYSQL_HOST="$DB_HOST" MYSQL_PORT="$DB_PORT" MYSQL_USER="$DB_USER" MYSQL_PASSWORD="$DB_PASSWORD" MYSQL_DATABASE="$DB_NAME" \
      python3 "$APP_DIR/import_fdc_to_mysql.py" \
        --dataset-dir "$DATASET_DIR" \
        --host "$DB_HOST" \
        --port "$DB_PORT" \
        --user "$DB_USER" \
        --password "$DB_PASSWORD" \
        --database "$DB_NAME" \
        $TRUNCATE_FLAG

    say "Dataset import finished."
  fi
fi

echo
say "Done."

say "Starting USDA API service..."
systemctl restart usda_api

echo "Admin UI: http://127.0.0.1:8080/admin"
echo "Health:    http://127.0.0.1:8080/health"
echo
say "Admin bootstrap: username 'admin' password 'admin' (you will be forced to change it)."

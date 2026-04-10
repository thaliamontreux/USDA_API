#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-0} -ne 0 ]]; then
  echo "Please run as root (use sudo)." >&2
  exit 1
fi

say() { echo "[update] $*"; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

if [[ ! -d "$SCRIPT_DIR/usda_api" ]]; then
  echo "Expected '$SCRIPT_DIR/usda_api' to exist. Run this script from the project root." >&2
  exit 1
fi

APP_DIR="/opt/usda_api"
SERVICE_NAME="usda_api"

say "Deploying application files to $APP_DIR..."
mkdir -p "$APP_DIR"
rsync -a --delete "$SCRIPT_DIR/usda_api/" "$APP_DIR/"

if [[ -f "$SCRIPT_DIR/import_fdc_to_mysql.py" ]]; then
  cp -f "$SCRIPT_DIR/import_fdc_to_mysql.py" "$APP_DIR/import_fdc_to_mysql.py"
fi
if [[ -f "$SCRIPT_DIR/schema.sql" ]]; then
  cp -f "$SCRIPT_DIR/schema.sql" "$APP_DIR/schema.sql"
fi

if id -u usda_api >/dev/null 2>&1; then
  chown -R usda_api:usda_api "$APP_DIR"
fi

say "Installing Node dependencies (production only)..."
cd "$APP_DIR"
if id -u usda_api >/dev/null 2>&1; then
  if [[ -f package-lock.json ]]; then
    sudo -u usda_api npm ci --omit=dev
  else
    sudo -u usda_api npm install --omit=dev
  fi
else
  if [[ -f package-lock.json ]]; then
    npm ci --omit=dev
  else
    npm install --omit=dev
  fi
fi

say "Restarting systemd service: ${SERVICE_NAME}..."
systemctl daemon-reload
systemctl restart "$SERVICE_NAME"

say "Done."

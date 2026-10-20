#!/usr/bin/env bash
# Prepare production deployment; no Node.js install or container start.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo 'Run with sudo: sudo bash install.sh' >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Engine and Docker Compose plugin must be installed first.' >&2
  exit 1
fi
APP_DIR="${APP_DIR:-/opt/aws-lightsail-manager}"
BASE='https://raw.githubusercontent.com/h-zare-dev/aws-lightsail-manager/main'
install -d -m 0755 "$APP_DIR" "$APP_DIR/config" "$APP_DIR/aws" "$APP_DIR/scripts"
curl -fsSL "$BASE/deploy/compose.yaml" -o "$APP_DIR/compose.yaml"
if [ ! -f "$APP_DIR/.env" ]; then
  curl -fsSL "$BASE/.env.example" -o "$APP_DIR/.env"
fi
if [ ! -f "$APP_DIR/config/accounts.json" ]; then
  curl -fsSL "$BASE/config/accounts.example.json" -o "$APP_DIR/config/accounts.json"
fi
if [ ! -f "$APP_DIR/aws/credentials" ]; then
  install -m 0600 /dev/null "$APP_DIR/aws/credentials"
fi
if [ ! -f "$APP_DIR/scripts/bootstrap-example.sh" ]; then
  curl -fsSL "$BASE/scripts/bootstrap-example.sh" -o "$APP_DIR/scripts/bootstrap-example.sh"
fi
# node:22-alpine's default unprivileged user has UID 1000.
chown 1000:1000 "$APP_DIR/config/accounts.json" "$APP_DIR/aws/credentials"
chmod 0600 "$APP_DIR/.env" "$APP_DIR/config/accounts.json" "$APP_DIR/aws/credentials"
chmod 0644 "$APP_DIR/compose.yaml" "$APP_DIR/scripts/bootstrap-example.sh"
echo "Prepared $APP_DIR; no container has been started."
echo 'Edit .env, config/accounts.json and aws/credentials.'
echo "Start: cd '$APP_DIR' && docker compose pull && docker compose up -d --force-recreate"

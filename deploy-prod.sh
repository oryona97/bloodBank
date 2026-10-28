#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE=".env.production"
PROD_COMPOSE_FILE="$SCRIPT_DIR/compose.production.yaml"
IMAGE_MODE="build"
WAIT_TIMEOUT=180

usage() {
  cat <<'EOF'
Blood Bank production deployment

Usage:
  bash ./deploy-prod.sh [options]

Options:
  --no-build          Reuse the configured app image without building.
  --pull              Pull the configured app image instead of building.
  --env-file PATH     Use another production env file (default: .env.production).
  --timeout SECONDS  Wait for healthy services (default: 180 seconds).
  -h, --help          Show this help.

Migrations run automatically when the app container starts.
Nginx in the separate Proxmox LXC connects to APP_BIND_IP:APP_PORT.
EOF
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build|--pull)
      [[ "$IMAGE_MODE" == "build" ]] || fail 'Choose either --no-build or --pull.'
      if [[ "$1" == "--pull" ]]; then
        IMAGE_MODE="pull"
      else
        IMAGE_MODE="reuse"
      fi
      shift
      ;;
    --env-file)
      [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || fail '--env-file requires a path.'
      ENV_FILE="$2"
      shift 2
      ;;
    --timeout)
      [[ $# -ge 2 && "$2" =~ ^[1-9][0-9]*$ ]] || fail '--timeout requires a positive integer.'
      WAIT_TIMEOUT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE. Copy .env.production.example and fill in your server settings."
[[ -f "$PROD_COMPOSE_FILE" ]] || fail "Missing $PROD_COMPOSE_FILE."
command -v docker >/dev/null 2>&1 || fail 'Docker is not installed or is not in PATH.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose is unavailable.'

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$PROD_COMPOSE_FILE")

echo '==> Validating production configuration...'
"${COMPOSE[@]}" config --quiet
docker info >/dev/null 2>&1 || fail 'Cannot access the Docker daemon. Start Docker or run this script with sudo if your server requires it.'

trap 'printf "ERROR: Deployment failed. Inspect the production app/db status and logs using the same env file and compose.production.yaml.\n" >&2' ERR

UP_ARGS=(up -d --wait --wait-timeout "$WAIT_TIMEOUT")
case "$IMAGE_MODE" in
  build)
    UP_ARGS+=(--build)
    ;;
  pull)
    echo '==> Pulling the configured application image...'
    "${COMPOSE[@]}" pull app
    UP_ARGS+=(--no-build)
    ;;
  reuse)
    UP_ARGS+=(--no-build)
    ;;
esac

echo '==> Deploying Blood Bank and waiting for healthy services...'
"${COMPOSE[@]}" "${UP_ARGS[@]}"

echo '==> Container status:'
"${COMPOSE[@]}" ps
APP_PUBLISHED_ADDRESS="$("${COMPOSE[@]}" port app 3001)"
echo '==> Production containers are healthy.'
printf '    Nginx upstream: http://%s\n' "$APP_PUBLISHED_ADDRESS"
echo '    Public URL after DNS/TLS/Nginx setup: https://bloodbank.proida.dev'

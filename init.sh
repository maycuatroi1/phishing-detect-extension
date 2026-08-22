#!/usr/bin/env sh
set -eu

ROOT=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT"

log() {
    printf '[init] %s\n' "$1"
}

fail() {
    printf '[init] ERROR: %s\n' "$1" >&2
    exit 1
}

command -v node >/dev/null 2>&1 || fail "node not found on PATH (need Node >= 22.12)"
log "node $(node --version)"

command -v pnpm >/dev/null 2>&1 || fail "pnpm not found on PATH (need pnpm 11, try: corepack enable)"
log "pnpm $(pnpm --version)"

if [ -f .env ]; then
    log ".env already exists, leaving it alone"
else
    cp .env.example .env
    log "created .env from .env.example"
fi

log "installing dependencies"
pnpm install

log "building once so dist/ exists and the secret post-check runs"
pnpm --filter extension build

log "done. Load unpacked from $ROOT/dist in chrome://extensions"

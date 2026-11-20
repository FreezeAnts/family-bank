#!/usr/bin/env bash
# Pull the latest (or tagged) GitHub Release and refresh the install tree.
# Mirrors Unison's "check GitHub Releases" model for a self-hosted Node app.
set -euo pipefail

OWNER="${GITHUB_OWNER:-FreezeAnts}"
REPO="${GITHUB_REPO:-family-bank}"
APP_DIR="${APP_DIR:-/opt/family-bank}"
SERVICE="${SERVICE_NAME:-family-bank}"
TAG="${TAG:-}"
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need curl
need tar
need jq

API="https://api.github.com/repos/${OWNER}/${REPO}/releases"
if [[ -n "$TAG" ]]; then
  META="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H "User-Agent: FamilyBank-Updater" "${API}/tags/${TAG}")"
else
  META="$(curl -fsSL -H 'Accept: application/vnd.github+json' -H "User-Agent: FamilyBank-Updater" "${API}/latest")"
fi

TAG_NAME="$(jq -r '.tag_name // empty' <<<"$META")"
[[ -n "$TAG_NAME" ]] || { echo "No release tag found for ${OWNER}/${REPO}" >&2; exit 1; }

ASSET_URL="$(jq -r '
  (.assets // [])
  | map(select(.name | test("^family-bank-"; "i")) | select(.name | test("\\.(tar\\.gz|tgz|zip)$"; "i")))
  | .[0].browser_download_url // empty
' <<<"$META")"
TARBALL_URL="$(jq -r '.tarball_url // empty' <<<"$META")"
DOWNLOAD_URL="${ASSET_URL:-$TARBALL_URL}"
[[ -n "$DOWNLOAD_URL" ]] || { echo "Release ${TAG_NAME} has no downloadable archive" >&2; exit 1; }

echo "Updating ${APP_DIR} to ${TAG_NAME} from ${DOWNLOAD_URL}"
ARCHIVE="$TMP/release.tgz"
curl -fsSL -H "User-Agent: FamilyBank-Updater" -o "$ARCHIVE" "$DOWNLOAD_URL"

EXTRACT="$TMP/extract"
mkdir -p "$EXTRACT"
tar -xzf "$ARCHIVE" -C "$EXTRACT"
SRC="$(find "$EXTRACT" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[[ -d "$SRC" ]] || SRC="$EXTRACT"

if [[ ! -f "$SRC/package.json" ]]; then
  echo "Extracted archive does not look like Family Bank (missing package.json)" >&2
  exit 1
fi

if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  systemctl stop "$SERVICE"
fi

mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude '.env' \
  "$SRC"/ "$APP_DIR"/

cd "$APP_DIR"
npm ci --omit=dev
node --experimental-sqlite src/db/migrate.js

if systemctl list-unit-files "$SERVICE.service" >/dev/null 2>&1; then
  systemctl start "$SERVICE"
  systemctl --no-pager --full status "$SERVICE" || true
fi

echo "Family Bank updated to ${TAG_NAME}"

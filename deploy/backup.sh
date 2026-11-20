#!/bin/bash
set -euo pipefail
SRC="${DATABASE_PATH:-/var/lib/family-bank/family-bank.sqlite}"
DEST_DIR="${BACKUP_DIR:-/var/backups/family-bank}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$DEST_DIR"
sqlite3 "$SRC" ".backup '$DEST_DIR/family-bank-$STAMP.sqlite'"
# Keep last 30 backups
ls -1t "$DEST_DIR"/family-bank-*.sqlite | tail -n +31 | xargs -r rm --
echo "Backup written: $DEST_DIR/family-bank-$STAMP.sqlite"

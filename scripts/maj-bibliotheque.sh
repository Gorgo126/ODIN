#!/usr/bin/env bash
set -euo pipefail

ODIN="$(cd "$(dirname "$0")/.." && pwd)"
# Data folder: DATA_DIR of .env (relative to ODIN unless absolute), as install.sh and compose.yml
DATA=$(sed -n 's/^DATA_DIR=//p' "$ODIN/.env" 2>/dev/null | tail -1); DATA=${DATA:-./data}
case "$DATA" in /*) ;; *) DATA="$ODIN/${DATA#./}" ;; esac
ZIM_DIR="$DATA/zim"
LIB="$ZIM_DIR/library.xml"
# Same kiwix-serve version as compose.yml
IMAGE="$(grep -oE 'ghcr.io/kiwix/kiwix-serve:[^ ]+' "$ODIN/compose.yml")"

sudo rm -f "$LIB"

shopt -s nullglob
for f in "$ZIM_DIR"/*.zim; do
  nom=$(basename "$f")
  echo "Ajout : $nom"
  docker run --rm --user root -v "$ZIM_DIR:/data" \
    --entrypoint kiwix-manage "$IMAGE" \
    /data/library.xml add "/data/$nom"
done

[ -f "$LIB" ] || printf '<?xml version="1.0" encoding="UTF-8"?>\n<library version="20110515">\n</library>\n' | sudo tee "$LIB" > /dev/null

# Same owner as the folder (the user who installed ODIN)
sudo chown "$(stat -c %U:%G "$ZIM_DIR")" "$LIB"
echo "Bibliothèque régénérée."

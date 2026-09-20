#!/usr/bin/env bash
set -euo pipefail

ZIM_DIR="/opt/odin/data/zim"
LIB="$ZIM_DIR/library.xml"
IMAGE="ghcr.io/kiwix/kiwix-serve:latest"

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

sudo chown ubuntu:ubuntu "$LIB"
echo "Bibliothèque régénérée."

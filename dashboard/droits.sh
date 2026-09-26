#!/bin/sh
# One-shot « droits » service (compose.yml), as root with CAP_CHOWN only, before the dashboard, which
# runs as node. Gives back to node what is not already its own in the dashboard's data folders: a
# folder created by Docker during an update without the installer (root:root), files written while
# the dashboard still ran as root. Only what is wrongly owned is changed: never a chown -R over the
# packs. Symbolic links are changed themselves, never followed (-h); -xdev stays on each volume.
set -eu
PROPRIETAIRE="$(id -u node):$(id -g node)"
UID_NODE=$(id -u node)
GID_NODE=$(id -g node)
debut=$(cut -d' ' -f1 /proc/uptime)
n=0
for d in /config /data /cartes /livres /assistant /traduction /messages; do
  [ -d "$d" ] || continue
  c=$(find "$d" -xdev \( ! -user "$UID_NODE" -o ! -group "$GID_NODE" \) -exec chown -h "$PROPRIETAIRE" {} + -print | wc -l)
  [ "$c" -gt 0 ] && echo "droits : $d, $c élément(s) rendu(s) à $PROPRIETAIRE"
  n=$((n + c))
done
fin=$(cut -d' ' -f1 /proc/uptime)
echo "droits : $n élément(s) corrigé(s) en $(echo "$debut $fin" | awk '{printf "%.2f", $2 - $1}') s"

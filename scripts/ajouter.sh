#!/usr/bin/env bash
set -euo pipefail

ODIN="$(cd "$(dirname "$0")/.." && pwd)"
CATALOGUE="$ODIN/catalogue/packs.txt"
ZIM_DIR="$ODIN/data/zim"
OPDS="https://library.kiwix.org/catalog/v2/entries"

# Une ligne par variante disponible : variante<TAB>url<TAB>octets
variantes() {
  curl -fsSL "$OPDS?name=$1&count=20" | awk '
    /<flavour>/ { v=$0; gsub(/.*<flavour>|<\/flavour>.*/, "", v) }
    /acquisition\/open-access/ {
      match($0, /href="[^"]*"/);    h=substr($0, RSTART+6, RLENGTH-7)
      match($0, /length="[0-9]*"/); t=substr($0, RSTART+8, RLENGTH-9)
      print v "\t" h "\t" t
    }'
}

choisir() { variantes "$1" | awk -F'\t' -v v="$2" '$1==v || v=="-" {print; exit}'; }
taille()  { numfmt --to=iec --suffix=o "$1" 2>/dev/null || echo "$1 o"; }
packs()   { grep -v -e '^#' -e '^$' "$CATALOGUE"; }

if [ $# -eq 0 ] || [ "$1" = "--liste" ]; then
  echo "Packs disponibles :"
  packs | while IFS='|' read -r id nom var libelle; do
    octets=$(choisir "$nom" "$var" | cut -f3) || true
    if [ -n "$octets" ]; then
      printf "  %-20s %8s  %s\n" "$id" "$(taille "$octets")" "$libelle"
    else
      printf "  %-20s %8s  %s\n" "$id" "" "$libelle  [introuvable]"
    fi
  done
  echo
  echo "Installer : $0 <identifiant>"
  exit 0
fi

IFS='|' read -r _ nom var libelle <<< "$(packs | awk -F'|' -v id="$1" '$1==id')"
[ -n "$nom" ] || { echo "Pack inconnu : $1  voir $0 --liste"; exit 1; }

choix=$(choisir "$nom" "$var") || true
if [ -z "$choix" ]; then
  echo "Variante  $var  introuvable pour $nom. Disponibles :"
  variantes "$nom" | cut -f1 | sed 's/^/  /'
  exit 1
fi

url=$(cut -f2 <<< "$choix"); url="${url%.meta4}"
octets=$(cut -f3 <<< "$choix")
fichier=$(basename "$url")

if [ -f "$ZIM_DIR/$fichier" ]; then
  echo "Déjà à jour : $fichier"
  exit 0
fi

libre=$(df --output=avail -B1 "$ZIM_DIR" | tail -1)
if [ "$libre" -le "$octets" ]; then
  echo "Espace insuffisant : il faut $(taille "$octets"), il reste $(taille "$libre")."
  exit 1
fi

echo "Téléchargement : $libelle ($(taille "$octets"))"
wget -c -q --show-progress -O "$ZIM_DIR/$fichier.part" "$url"
mv "$ZIM_DIR/$fichier.part" "$ZIM_DIR/$fichier"

for ancien in "$ZIM_DIR/${nom}_"*.zim; do
  [ -e "$ancien" ] && [ "$ancien" != "$ZIM_DIR/$fichier" ] || continue
  echo "Suppression de l'ancienne version : $(basename "$ancien")"
  rm -f "$ancien"
done

"$ODIN/scripts/maj-bibliotheque.sh"

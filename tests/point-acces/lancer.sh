#!/usr/bin/env bash
# Tests A of the access point (docs/conception-point-acces.md): detection, country, channel, range,
# QR escaping. Bash only, recorded iw outputs and fake tools, nothing changed on the machine.
#   bash tests/point-acces/lancer.sh
set -u
ICI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
S="$ICI/sorties"
VIDE=$(mktemp -d)
trap 'rm -rf "$VIDE"' EXIT
touch "$VIDE/.env"
export VIDE PATH="$ICI/faux:$PATH" POINT_ACCES_CIBLE="$VIDE" ZONE_TAB="$S/zone.tab" POINT_ACCES_ETC="$VIDE/etc" POINT_ACCES_VERROU="$VIDE/verrou"
reussis=0; rates=0

# cas <name> <expected> <command>: runs the command in a clean shell with the script loaded
cas() {
  local nom=$1 attendu=$2 obtenu
  obtenu=$(bash -c ". '$ICI/../../scripts/point-acces.sh'; lire_config; decouper_reseau \"\$RESEAU\"; $3" 2>&1)
  if [ "$obtenu" = "$attendu" ]; then reussis=$((reussis + 1)); echo "  ok    $nom"
  else rates=$((rates + 1)); echo "  ÉCHEC $nom : attendu « $attendu », obtenu « $obtenu »"; fi
}
det='detecter; echo "${DET_RAISON:-ok} ${DET_IF}"'
route='detecter; echo "${DET_RAISON:-ok} ${DET_IF} route=${DET_ROUTE} carte=${DET_CARTE} ap=${DET_AP}"'

echo "Détection"
FAUX_IW_DEV= cas "aucune carte" "aucune-carte " "$det"
FAUX_IW_DEV="$S/iw-dev-une.txt" FAUX_IW_PHY="$S/iw-phy-sans-ap.txt" cas "carte sans mode AP" "pas-de-mode-ap wlp2s0" "$det"
FAUX_IW_DEV="$S/iw-dev-une.txt" FAUX_IW_PHY="$S/iw-phy-ap.txt" cas "carte compatible" "ok wlp2s0" "$det"
FAUX_IW_DEV="$S/iw-dev-une.txt" FAUX_IW_PHY="$S/iw-phy-ap.txt" FAUX_ROUTE_DEFAUT="default via 192.168.1.1 dev wlp2s0 proto dhcp" \
  cas "carte qui porte la connexion : utilisable, signalée" "ok wlp2s0 route=oui carte=oui ap=oui" "$route"
FAUX_IW_DEV="$S/iw-dev-une.txt" FAUX_IW_PHY="$S/iw-phy-ap.txt" FAUX_ADRESSES="3: wlp2s0    inet 192.168.1.20/24 brd 192.168.1.255 scope global dynamic wlp2s0" \
  cas "carte avec une adresse : utilisable" "ok wlp2s0 route=non carte=oui ap=oui" "$route"
FAUX_IW_DEV="$S/iw-dev-une.txt" FAUX_IW_PHY="$S/iw-phy-ap.txt" FAUX_IW_LINK="Connected to aa:bb:cc:dd:ee:ff (on wlp2s0)" \
  cas "carte connectée : utilisable" "ok wlp2s0" "$det"
FAUX_IW_DEV= cas "aucune carte : ni carte ni mode AP" "aucune-carte  route=non carte=non ap=non" "$route"
FAUX_IW_DEV="$S/iw-dev-une.txt" FAUX_IW_PHY="$S/iw-phy-sans-ap.txt" cas "sans mode AP : carte, pas d'AP" "pas-de-mode-ap wlp2s0 route=non carte=oui ap=non" "$route"
FAUX_IW_DEV="$S/iw-dev-une.txt" FAUX_IW_PHY="$S/iw-phy-ap.txt" FAUX_ADRESSES="3: wlp2s0    inet 10.42.0.1/24 scope global wlp2s0" \
  cas "sa propre adresse ne l'occupe pas" "ok wlp2s0" "$det"
FAUX_IW_DEV="$S/iw-dev-une.txt" FAUX_IW_PHY="$S/iw-phy-ap.txt" POINT_ACCES_INTERFACE=wlan9 \
  cas "interface imposée absente" "aucune-carte wlan9" "$det"
FAUX_IW_DEV="$S/iw-dev-deux.txt" FAUX_IW_PHY="$S/iw-phy-ap.txt" POINT_ACCES_INTERFACE=wlp2s0 \
  cas "interface imposée présente" "ok wlp2s0" "$det"
FAUX_IW_DEV="$S/iw-dev-une.txt" FAUX_IW_PHY="$S/iw-phy-ap.txt" FAUX_ROUTES="default via 192.168.1.1 dev eth0
10.42.0.0/16 dev tun0 scope link
192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.5" \
  cas "plage déjà routée ailleurs" "plage-occupee wlp2s0" "$det"
FAUX_IW_DEV="$S/iw-dev-une.txt" FAUX_IW_PHY="$S/iw-phy-ap.txt" FAUX_ROUTES="10.42.0.0/24 dev wlp2s0 proto kernel scope link src 10.42.0.1
10.43.0.0/24 dev eth1 scope link" \
  cas "sa propre route et une plage voisine" "ok wlp2s0" "$det"

FAUX_IW_DEV="$S/iw-dev-une.txt" FAUX_IW_PHY="$S/iw-phy-ap.txt" FAUX_DOCKER_RESEAUX="172.17.0.0/16
10.42.0.0/16" \
  cas "plage prise par un réseau Docker" "plage-occupee wlp2s0" "$det"

echo "Choix de la plage"
FAUX_DOCKER_RESEAUX="172.17.0.0/16" cas "par défaut : 10.42" "10.42.0.1/24 " 'choisir_plage; echo "$RESEAU $PLAGE_RAISON"'
FAUX_DOCKER_RESEAUX="10.42.0.0/24" cas "10.42 pris par Docker : 10.43" "10.43.0.1/24 " 'choisir_plage; echo "$RESEAU $PLAGE_RAISON"'
FAUX_ROUTES="10.42.0.0/16 dev tun0 scope link
10.43.0.0/24 dev eth0 proto kernel scope link" cas "10.42 et 10.43 routés : 10.44" "10.44.0.1/24 " 'choisir_plage; echo "$RESEAU $PLAGE_RAISON"'
FAUX_ROUTES="10.0.0.0/8 dev eth0 proto kernel scope link" cas "tout 10/8 pris : refus clair" "plage-occupee" 'choisir_plage || echo "$PLAGE_RAISON"'
FAUX_ROUTES="10.44.0.0/24 dev wlp2s0 scope link" cas "plage actuelle gardée (sa propre route)" "10.44.0.1/24 " 'choisir_plage 10.44.0.1/24 wlp2s0; echo "$RESEAU $PLAGE_RAISON"'
POINT_ACCES_RESEAU=192.168.50.1/24 FAUX_ROUTES="192.168.50.0/24 dev eth0 scope link" cas "plage imposée occupée : refus" "plage-occupee 192.168.50.1/24" 'choisir_plage || echo "$PLAGE_RAISON $RESEAU"'
POINT_ACCES_RESEAU=10.42.0.1/24 FAUX_DOCKER_RESEAUX="10.42.0.0/24" cas "ancienne valeur par défaut de .env : pas imposée" "10.43.0.1/24" 'choisir_plage; echo "$RESEAU"'

echo "Demandes du tableau de bord"
dem='mkdir -p "$VIDE/d/config" "$POINT_ACCES_ETC"; printf "RESEAU=10.42.0.1/24\nDATA=%s\n" "$VIDE/d" > "$POINT_ACCES_ETC/parametres"; activer() { echo ACTIVER; }; desactiver() { echo DESACTIVER; }; f="$VIDE/d/config/point-acces-demande"'
cas "activer" $'ACTIVER\nabsente' "$dem; echo activer > \"\$f\"; demande 2>&1; [ -e \"\$f\" ] || echo absente"
cas "desactiver (espaces et fin de ligne)" "DESACTIVER" "$dem; printf ' desactiver \\n' > \"\$f\"; demande 2>&1"
cas "valeur inconnue : ignorée" $'Demande ignorée : « rm-rf? » n\'est pas une action connue.\nabsente' "$dem; printf 'rm -rf /' > \"\$f\"; demande 2>&1; [ -e \"\$f\" ] || echo absente"
cas "commande injectée : ignorée, rien exécuté" "Demande ignorée : « activer?touch??????x? » n'est pas une action connue." "$dem; printf 'activer;touch \$VIDE/x;' > \"\$f\"; demande 2>&1; [ -e \"\$VIDE/x\" ] && echo EXECUTE"
cas "lien symbolique : ignoré" $'Demande ignorée : lien symbolique.\nabsente' "$dem; ln -s /etc/hostname \"\$f\"; demande 2>&1; [ -e \"\$f\" ] || [ -L \"\$f\" ] || echo absente"
cas "rien à faire sans demande" "" "$dem; demande 2>&1"

echo "Pays"
FAUX_FUSEAU=UTC cas "fuseau UTC" "00" "pays"
FAUX_FUSEAU=Europe/Brussels cas "fuseau Europe/Brussels" "BE" "pays"
FAUX_FUSEAU=Africa/Kinshasa cas "fuseau Africa/Kinshasa" "CD" "pays"
FAUX_FUSEAU=Europe/Brussels PAYS=fr cas "PAYS imposé (minuscules)" "FR" "pays"
FAUX_FUSEAU=Europe/Brussels PAYS=xyz cas "PAYS invalide : fuseau" "BE" "pays"

echo "Canal"
FAUX_IW_SCAN="$S/scan-voisins.txt" cas "groupe le moins chargé (11)" "11" "choisir_canal wlp2s0"
FAUX_IW_SCAN= cas "scan en échec : 6" "6" "choisir_canal wlp2s0"
cas "scan vide : 6" "6" "canal_depuis_scan </dev/null"

echo "Réseau"
cas "plage par défaut" "10.42.0.1 24 255.255.255.0 10.42.0.10 10.42.0.250 10.42.0.0/24" 'echo "$ADRESSE $PREFIXE $MASQUE $DEBUT $FIN $CIDR"'
POINT_ACCES_RESEAU=192.168.50.1/24 cas "plage imposée" "192.168.50.10 192.168.50.250" 'echo "$DEBUT $FIN"'
cas "plage invalide refusée" "refus" 'decouper_reseau 10.42.0.1/30 || echo refus'

echo "Formats"
cas "QR : caractères spéciaux échappés" 'Caf\;\,\:\"\\' "echapper_qr 'Caf;,:\"\\'"
cas "mot de passe xxxx-xxxx-xxxx sans 0 o 1 l" "ok" 'p=$(generer_mot_de_passe); [[ "$p" =~ ^[a-km-np-z2-9]{4}-[a-km-np-z2-9]{4}-[a-km-np-z2-9]{4}$ ]] && echo ok || echo "$p"'
cas "JSON : guillemets et barre oblique inverse" '"a\"b\\c"' "echapper_json 'a\"b\\c'"

echo
echo "$reussis réussis, $rates en échec"
[ "$rates" -eq 0 ]

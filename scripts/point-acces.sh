#!/usr/bin/env bash
# ODIN access point: the machine creates its own Wi-Fi network, hostapd and dnsmasq on the host,
# under systemd (docs/conception-point-acces.md). Installed by install.sh on every machine, inactive;
# activated from the dashboard (/point-acces), which only drops a request file (see demande).
#
#   sudo scripts/point-acces.sh activer        take the Wi-Fi card, check it emits, else go back (30 s)
#   sudo scripts/point-acces.sh desactiver     give the card back, check the old connection returns
#   sudo scripts/point-acces.sh etat           state written to data/config/point-acces.json
#   sudo scripts/point-acces.sh detecter       Wi-Fi card usable? (nothing changed)
#   sudo scripts/point-acces.sh installer      files, units, password; nothing started (install.sh)
#   sudo scripts/point-acces.sh desinstaller   everything removed, card given back
#   demarrer, arreter, echec, demande          called by the systemd units only
#
# Entirely offline: no apt, git, docker pull nor download. Only the Wi-Fi card is touched: Ethernet,
# systemd-resolved and Docker stay as they are. No NAT, no internet sharing: the devices reach ODIN only.
set -uo pipefail
shopt -u patsub_replacement 2>/dev/null || true

CIBLE=${POINT_ACCES_CIBLE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
SCRIPT="$CIBLE/scripts/point-acces.sh"
MODELES="$CIBLE/config/point-acces"
ETC=${POINT_ACCES_ETC:-/etc/odin/point-acces}
RUN=${POINT_ACCES_RUN:-/run/odin-point-acces}
VERROU=${POINT_ACCES_VERROU:-/run/odin-point-acces.lock}
SYSTEMD=${POINT_ACCES_SYSTEMD:-/etc/systemd/system}
NM_CONF=${POINT_ACCES_NM_CONF:-/etc/NetworkManager/conf.d/odin-point-acces.conf}
NETWORKD_CONF=${POINT_ACCES_NETWORKD_CONF:-/etc/systemd/network/00-odin-point-acces.network}
ZONE_TAB=${ZONE_TAB:-/usr/share/zoneinfo/zone.tab}
# Units of the access point itself (started by the target) and of the service around it
UNITES_AP=(odin-point-acces.target odin-point-acces-reseau.service odin-hostapd.service odin-dnsmasq.service odin-point-acces-echec.service)
UNITES=("${UNITES_AP[@]}" odin-point-acces-demande.path odin-point-acces-demande.service odin-point-acces-etat.service)
# Time given to the access point to emit, and to the old connection to come back
DELAI=${POINT_ACCES_DELAI:-30}
# Ranges tried in turn when none is imposed (POINT_ACCES_RESEAU)
PLAGES=(10.42.0.1/24 10.43.0.1/24 10.44.0.1/24 10.45.0.1/24 10.46.0.1/24 10.47.0.1/24 10.48.0.1/24 10.49.0.1/24)
# Passwords: lower case and digits, without 0/o/1/l
ALPHABET=abcdefghijkmnpqrstuvwxyz23456789

# --- Configuration -------------------------------------------------------------------------------

# Value of a key in .env (last one wins), without executing the file
valeur_env() { sed -n "s/^$1=//p" "$CIBLE/.env" 2>/dev/null | tail -1 | sed 's/^"\(.*\)"$/\1/'; }

# .env, overridden by the environment (tests), then the defaults
lire_config() {
  IF_IMPOSEE=${POINT_ACCES_INTERFACE-$(valeur_env POINT_ACCES_INTERFACE)}
  SSID=${POINT_ACCES_SSID-$(valeur_env POINT_ACCES_SSID)}; SSID=${SSID:-ODIN}
  RESEAU_IMPOSE=${POINT_ACCES_RESEAU-$(valeur_env POINT_ACCES_RESEAU)}
  # The old default written in every .env (lots 1 and 2) is not a choice of the owner
  [ "$RESEAU_IMPOSE" = "${PLAGES[0]}" ] && RESEAU_IMPOSE=
  RESEAU=${RESEAU_IMPOSE:-${PLAGES[0]}}
  PAYS_IMPOSE=${PAYS-$(valeur_env PAYS)}
  local d; d=$(valeur_env DATA_DIR); d=${d:-./data}
  case "$d" in /*) DATA=$d ;; *) DATA="$CIBLE/${d#./}" ;; esac
  DATA=${POINT_ACCES_DATA:-$DATA}
  NOM=$(hostname)
}

# Parameters written at installation (range, data folder…) and at activation (interface, country):
# the units never read .env
charger_parametres() {
  [ -f "$ETC/parametres" ] || { echo "Point d'accès non installé ($ETC/parametres absent)." >&2; return 1; }
  INTERFACE=; PAYS_CODE=
  # shellcheck disable=SC1091
  . "$ETC/parametres"
  NOM=$(hostname)
  decouper_reseau "$RESEAU"
}

ecrire_parametres() {
  ecrire_si_change "$ETC/parametres" "$(printf 'INTERFACE=%q\nRESEAU=%q\nSSID=%q\nPAYS_CODE=%q\nDATA=%q\n' "${INTERFACE:-}" "$RESEAU" "$SSID" "${PAYS_CODE:-}" "$DATA")" 600
}

# --- Addresses ------------------------------------------------------------------------------------

ip_en_nombre() { local IFS=.; set -- $1; echo $(( ($1 << 24) + ($2 << 16) + ($3 << 8) + $4 )); }
nombre_en_ip() { echo "$(( $1 >> 24 & 255 )).$(( $1 >> 16 & 255 )).$(( $1 >> 8 & 255 )).$(( $1 & 255 ))"; }
masque_de() { echo $(( $1 == 0 ? 0 : (0xFFFFFFFF << (32 - $1)) & 0xFFFFFFFF )); }

# 10.42.0.1/24 → ADRESSE, PREFIXE, MASQUE, DEBUT (.10), FIN (.250), CIDR ; false when invalid
decouper_reseau() {
  [[ "$1" =~ ^([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/([0-9]{1,2})$ ]] || return 1
  ADRESSE=${BASH_REMATCH[1]}; PREFIXE=${BASH_REMATCH[2]}
  (( PREFIXE >= 16 && PREFIXE <= 24 )) || return 1
  local n m base
  n=$(ip_en_nombre "$ADRESSE"); m=$(masque_de "$PREFIXE"); base=$(( n & m ))
  MASQUE=$(nombre_en_ip "$m")
  CIDR="$(nombre_en_ip "$base")/$PREFIXE"
  DEBUT=$(nombre_en_ip $(( base + 10 )))
  FIN=$(nombre_en_ip $(( base + 250 )))
}

# Do a.b.c.d/p and our range overlap? (the shorter prefix decides)
chevauche() {
  local dest=$1 pd m
  [[ "$dest" == */* ]] || dest="$dest/32"
  pd=${dest#*/}
  [[ "${dest%/*}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  m=$(masque_de $(( pd < PREFIXE ? pd : PREFIXE )))
  (( ( $(ip_en_nombre "${dest%/*}") & m ) == ( $(ip_en_nombre "$ADRESSE") & m ) ))
}

# Subnets of the Docker networks, even those without a bridge up yet (local command, no network)
reseaux_docker() {
  command -v docker >/dev/null || return 0
  local ids; ids=$(timeout 5 docker network ls -q 2>/dev/null) || return 0
  [ -n "$ids" ] || return 0
  # shellcheck disable=SC2086
  timeout 5 docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}' $ids 2>/dev/null | tr ' ' '\n' | grep -v ':' | grep .
}

# Another interface already routes part of this range (the box, a VPN), or a Docker network uses it.
# $1: our own interface, whose routes do not count
plage_occupee() {
  local ligne dest autre
  while read -r ligne; do
    dest=${ligne%% *}
    autre=$(sed -n 's/.* dev \([^ ]*\).*/\1/p' <<<"$ligne")
    [ "$dest" = default ] && continue
    [ -n "${1:-}" ] && [ "$autre" = "$1" ] && continue
    chevauche "$dest" && return 0
  done < <(ip -4 route show 2>/dev/null)
  while read -r dest; do
    [ -n "$dest" ] && chevauche "$dest" && return 0
  done < <(reseaux_docker)
  return 1
}

# Range of the network, at installation: the imposed one (refused when in use), else the current one
# while it is free, else the first free one of PLAGES. Sets RESEAU and PLAGE_RAISON (empty when fine).
choisir_plage() {
  local ancienne=${1:-} itf=${2:-} p
  PLAGE_RAISON=
  if [ -n "$RESEAU_IMPOSE" ]; then
    RESEAU=$RESEAU_IMPOSE
    decouper_reseau "$RESEAU" || { PLAGE_RAISON=plage-invalide; return 1; }
    plage_occupee "$itf" && { PLAGE_RAISON=plage-occupee; return 1; }
    return 0
  fi
  for p in $ancienne "${PLAGES[@]}"; do
    decouper_reseau "$p" || continue
    plage_occupee "$itf" && continue
    RESEAU=$p; return 0
  done
  RESEAU=${ancienne:-${PLAGES[0]}}; decouper_reseau "$RESEAU"
  PLAGE_RAISON=plage-occupee; return 1
}

# --- Detection ------------------------------------------------------------------------------------

# « interface phy » for each Wi-Fi interface
interfaces_wifi() {
  iw dev 2>/dev/null | awk '/^phy#/ { p = "phy" substr($1, 5) } $1 == "Interface" { print $2, p }'
}

# « * AP » in « Supported interface modes » only (not AP/VLAN, not the combinations)
mode_ap() {
  iw phy "$1" info 2>/dev/null | awk '
    /Supported interface modes:/ { dans = 1; next }
    dans && /^\t\t *\* / { if ($2 == "AP" && NF == 2) ok = 1; next }
    dans { dans = 0 }
    END { exit !ok }'
}

porte_route() { [ -n "$(ip route show default dev "$1" 2>/dev/null)" ]; }

# Default route, IPv4 address (other than ours) or connection to a network: the card is in use
interface_occupee() {
  local a
  porte_route "$1" && return 0
  a=$(ip -4 -o addr show dev "$1" 2>/dev/null | awk '{ split($4, x, "/"); print x[1] }' | grep -vx "${ADRESSE:-}")
  [ -n "$a" ] && return 0
  iw dev "$1" link 2>/dev/null | grep -q '^Connected to' && return 0
  return 1
}

# Default route through another interface than $1 (typically the Ethernet cable)
autre_route() { ip route show default 2>/dev/null | grep -v " dev $1\( \|$\)" | grep -q .; }

# PAYS, else the time zone looked up in zone.tab (Europe/Brussels → BE), else 00 (world domain:
# channels 1, 6 and 11 are allowed there)
pays() {
  local p=${PAYS_IMPOSE:-} fuseau
  if [[ "${p^^}" =~ ^[A-Z]{2}$ ]]; then echo "${p^^}"; return; fi
  fuseau=$(timedatectl show -p Timezone --value 2>/dev/null)
  p=$(awk -F'\t' -v f="$fuseau" '$1 !~ /^#/ && $3 == f { print $1; exit }' "$ZONE_TAB" 2>/dev/null)
  echo "${p:-00}"
}

# Sets DET_IF, DET_PHY, DET_CARTE (a Wi-Fi card is there), DET_AP (it can be an access point),
# DET_ROUTE (it carries the default route), DET_PAYS and DET_RAISON (empty when it can be used).
# A card that carries the connection can be used: activating then cuts it (the dashboard says so).
detecter() {
  DET_IF=; DET_PHY=; DET_RAISON=; DET_CARTE=non; DET_AP=non; DET_ROUTE=non; DET_PAYS=$(pays)
  local liste itf phy occupee=
  liste=$(interfaces_wifi)
  if [ -n "$IF_IMPOSEE" ]; then liste=$(awk -v i="$IF_IMPOSEE" '$1 == i' <<<"$liste"); fi
  if [ -z "$liste" ]; then DET_RAISON=aucune-carte; DET_IF=$IF_IMPOSEE; return; fi
  DET_CARTE=oui
  # The first free card that can be an access point, else the first one that can (in use)
  while read -r itf phy; do
    mode_ap "$phy" || continue
    if interface_occupee "$itf"; then [ -z "$occupee" ] && occupee="$itf $phy"; continue; fi
    DET_IF=$itf; DET_PHY=$phy; break
  done <<<"$liste"
  if [ -z "$DET_IF" ] && [ -n "$occupee" ]; then DET_IF=${occupee% *}; DET_PHY=${occupee#* }; fi
  if [ -z "$DET_IF" ]; then
    DET_RAISON=pas-de-mode-ap; DET_IF=$(awk 'NR == 1 { print $1 }' <<<"$liste"); return
  fi
  DET_AP=oui
  porte_route "$DET_IF" && DET_ROUTE=oui
  if plage_occupee "$DET_IF"; then DET_RAISON=plage-occupee; fi
}

message_raison() {
  case "$1" in
    aucune-carte) [ -n "${2:-}" ] && echo "Interface Wi-Fi $2 introuvable." || echo "Aucune carte Wi-Fi compatible détectée." ;;
    pas-de-mode-ap) echo "La carte Wi-Fi ${2:-} ne sait pas créer de point d'accès." ;;
    wifi-occupe) echo "La carte Wi-Fi ${2:-} porte la connexion de cette machine : l'installeur ne la coupe pas. Activez le point d'accès depuis le tableau de bord (page Point d'accès Wi-Fi), qui prévient avant de couper internet." ;;
    plage-occupee) echo "La plage d'adresses $RESEAU chevauche un réseau de la machine ou de Docker : relancez l'installeur, qui en choisira une autre, ou fixez POINT_ACCES_RESEAU dans .env." ;;
    plage-invalide) echo "POINT_ACCES_RESEAU invalide : $RESEAU (attendu : 10.42.0.1/24, préfixe de 16 à 24)." ;;
    echec-demarrage) echo "Le point d'accès n'a pas démarré (journal : journalctl -u odin-hostapd -u odin-dnsmasq -u odin-point-acces-reseau)." ;;
    *) echo "$1" ;;
  esac
}

# --- Channel --------------------------------------------------------------------------------------

# Networks counted by group (1-3 → 1, 4-8 → 6, 9-13 → 11) on scan output; least busy group, 6 on
# a tie or when the scan gives nothing.
canal_depuis_scan() {
  awk '
    $1 == "freq:" { f = int($2); if (f >= 2412 && f <= 2472) { c = (f - 2407) / 5; n[c <= 3 ? 1 : c <= 8 ? 6 : 11]++ } }
    END { best = 6; for (i = 0; i < 3; i++) { c = (i == 0 ? 6 : i == 1 ? 1 : 11); if (n[c] + 0 < n[best] + 0) best = c } print best }'
}

choisir_canal() {
  local sortie
  ip link set "$1" up 2>/dev/null
  sortie=$(timeout 8 iw dev "$1" scan 2>/dev/null) || { echo 6; return; }
  canal_depuis_scan <<<"$sortie"
}

# --- Files ----------------------------------------------------------------------------------------

# « WIFI:T:WPA;S:…;P:…;; » with \ ; , : " escaped, as the format requires
echapper_qr() { local s=${1//\\/\\\\}; s=${s//;/\\;}; s=${s//,/\\,}; s=${s//:/\\:}; s=${s//\"/\\\"}; printf '%s' "$s"; }
echapper_json() {
  local s=${1//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}; s=${s//$'\r'/\\r}
  printf '"%s"' "$s"
}
json_ou_null() { if [ -n "$1" ]; then echapper_json "$1"; else printf null; fi; }
json_bool() { [ "$1" = oui ] && printf true || printf false; }

generer_mot_de_passe() {
  local p
  p=$(LC_ALL=C tr -dc "$ALPHABET" < /dev/urandom 2>/dev/null | head -c 12)
  echo "${p:0:4}-${p:4:4}-${p:8:4}"
}

# Template with @KEY@ replaced; pairs KEY value…
remplir() {
  local t; t=$(<"$1"); shift
  while [ $# -ge 2 ]; do t=${t//@$1@/$2}; shift 2; done
  printf '%s\n' "$t"
}

# Writes $2 into $1 (mode $3) only if it changed; returns 0 when written
ecrire_si_change() {
  if [ -f "$1" ] && [ "$(cat "$1")" = "$2" ]; then return 1; fi
  install -m "$3" /dev/null "$1" && printf '%s\n' "$2" > "$1"
}

# hostapd and dnsmasq configurations for INTERFACE and PAYS_CODE; returns 0 when something changed
generer_configurations() {
  local change=1 mdp pays_lignes
  mdp=$(<"$ETC/mot-de-passe")
  # Country 00 (world domain) is not a country for hostapd: no country_code then
  if [ "$PAYS_CODE" = 00 ]; then pays_lignes="# Pays inconnu : domaine réglementaire mondial"; else pays_lignes="country_code=$PAYS_CODE"$'\n'"ieee80211d=1"; fi
  ecrire_parametres && change=0
  ecrire_si_change "$ETC/hostapd.conf" "$(remplir "$MODELES/hostapd.conf" INTERFACE "$INTERFACE" RUN "$RUN" SSID "$SSID" PAYS_LIGNES "$pays_lignes" MOT_DE_PASSE "$mdp")" 600 && change=0
  ecrire_si_change "$ETC/dnsmasq.conf" "$(remplir "$MODELES/dnsmasq.conf" INTERFACE "$INTERFACE" DEBUT "$DEBUT" FIN "$FIN" MASQUE "$MASQUE" ADRESSE "$ADRESSE" RUN "$RUN" NOM "$NOM")" 600 && change=0
  return $change
}

# --- State ----------------------------------------------------------------------------------------

# Last action and last error, kept between writes of the state: « action|result|date », « date|message »
noter_action() { install -d -m 700 "$ETC"; printf '%s|%s|%s\n' "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$ETC/derniere-action"; }
noter_erreur() { install -d -m 700 "$ETC"; printf '%s|%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" > "$ETC/derniere-erreur"; echo "$1" >&2; }

voulu_actif() { [ "$(cat "$ETC/voulu" 2>/dev/null)" = actif ]; }

# Emitting: hostapd and dnsmasq running, the card in AP mode
emet() {
  [ -n "${INTERFACE:-}" ] || return 1
  systemctl is-active --quiet odin-hostapd.service && systemctl is-active --quiet odin-dnsmasq.service \
    && iw dev "$INTERFACE" info 2>/dev/null | grep -q 'type AP'
}

# data/config/point-acces.json, read by the dashboard (it never writes it). 640, owner of data/config:
# the dashboard container runs as root and reads it. $1 forces the state (the units' ExecStartPost:
# « actif » while the other service is still in its start-post).
ecrire_etat() {
  local fichier="$DATA/config/point-acces.json" force=${1:-}
  [ -d "$DATA/config" ] || return 0
  local mdp= canal=null noms= action=null erreur=null a= r= d= m= etat= raison= actif=non
  [ -f "$ETC/mot-de-passe" ] && mdp=$(<"$ETC/mot-de-passe")
  [ -f "$RUN/canal" ] && canal=$(<"$RUN/canal")
  noms="[$(echapper_json "$NOM.lan")"
  systemctl is-active --quiet avahi-daemon 2>/dev/null && noms+=", $(echapper_json "$NOM.local")"
  noms+="]"
  if [ -f "$ETC/derniere-action" ]; then
    IFS='|' read -r a r d < "$ETC/derniere-action"
    action="{\"action\": $(echapper_json "$a"), \"resultat\": $(echapper_json "$r"), \"date\": $(echapper_json "$d")}"
  fi
  if [ -f "$ETC/derniere-erreur" ]; then
    IFS='|' read -r d m < "$ETC/derniere-erreur"
    erreur="{\"message\": $(echapper_json "$m"), \"date\": $(echapper_json "$d")}"
  fi
  # The card of the running access point stays « ours »; otherwise what the machine has now
  local garde_if=${INTERFACE:-}
  IF_IMPOSEE=${IF_IMPOSEE:-}
  if [ "$force" = actif ] || emet; then
    actif=oui; DET_CARTE=oui; DET_AP=oui; DET_ROUTE=non; DET_IF=$garde_if; DET_RAISON=
  else
    detecter
  fi
  if [ "$actif" = oui ]; then etat=actif
  elif [ "$r" = en-cours ] && [ -f "$ETC/derniere-action" ]; then etat=en-cours
  elif [ -n "$DET_RAISON" ]; then etat=indisponible; raison=$DET_RAISON
  else etat=inactif
  fi
  local rautre=non; [ -n "$DET_IF" ] && autre_route "$DET_IF" && rautre=oui
  [ -z "$DET_IF" ] && [ -n "$(ip route show default 2>/dev/null)" ] && rautre=oui
  local tmp; tmp=$(mktemp "$DATA/config/.point-acces.XXXXXX") || return 0
  cat > "$tmp" <<EOF
{
  "etat": "$etat",
  "raison": $(json_ou_null "$raison"),
  "actif": $(json_bool "$actif"),
  "carte": $(json_bool "$DET_CARTE"),
  "modeAP": $(json_bool "$DET_AP"),
  "routeParDefaut": $(json_bool "$DET_ROUTE"),
  "autreConnexion": $(json_bool "$rautre"),
  "interface": $(json_ou_null "${DET_IF:-$garde_if}"),
  "ssid": $(echapper_json "$SSID"),
  "motDePasse": $(json_ou_null "$mdp"),
  "adresse": $(json_ou_null "${ADRESSE:-}"),
  "reseau": $(json_ou_null "${CIDR:-}"),
  "noms": $noms,
  "canal": $canal,
  "pays": $(json_ou_null "${PAYS_CODE:-${DET_PAYS:-}}"),
  "derniereAction": $action,
  "derniereErreur": $erreur,
  "maj": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  INTERFACE=$garde_if
  chown "$(stat -c %u:%g "$DATA/config")" "$tmp" && chmod 640 "$tmp" && mv -f "$tmp" "$fichier"
}

# --- Firewall -------------------------------------------------------------------------------------

# No transit from the Wi-Fi to anywhere: only packets DNATed by Docker (the published port of
# Caddy) may be forwarded. Never forwarding=0 on the interface: that DNAT goes through forwarding.
# DOCKER-USER when it exists, FORWARD otherwise (Docker absent or not started yet).
regle() { echo "$1 -i $INTERFACE -m conntrack ! --ctstate DNAT -j DROP"; }
poser_pare_feu() {
  local t chaine
  for t in iptables ip6tables; do
    command -v "$t" >/dev/null || continue
    chaine=FORWARD; $t -w -n -L DOCKER-USER >/dev/null 2>&1 && chaine=DOCKER-USER
    # shellcheck disable=SC2046
    $t -w -C $(regle "$chaine") 2>/dev/null || $t -w -I $(regle "$chaine") || return 1
  done
}
retirer_pare_feu() {
  local t chaine
  for t in iptables ip6tables; do
    command -v "$t" >/dev/null || continue
    for chaine in DOCKER-USER FORWARD; do
      # shellcheck disable=SC2046
      while $t -w -C $(regle "$chaine") 2>/dev/null; do $t -w -D $(regle "$chaine"); done
    done
  done
}

# --- Network managers: take the card, give it back ------------------------------------------------

nm_actif() { systemctl is-active --quiet NetworkManager 2>/dev/null; }
# NetworkManager manages this card (any state but « unmanaged »)
nm_gere() {
  nm_actif || return 1
  local e; e=$(nmcli -t -f DEVICE,STATE device status 2>/dev/null | awk -F: -v i="$1" '$1 == i { print $2 }')
  [ -n "$e" ] && [ "$e" != unmanaged ]
}
# systemd-networkd manages this card (netplan « wifis: » on Ubuntu Server), or netplan runs a
# wpa_supplicant for it
networkd_gere() {
  local s
  [ "$(systemctl show -p LoadState --value "netplan-wpa-$1.service" 2>/dev/null)" = loaded ] && return 0
  systemctl is-active --quiet systemd-networkd 2>/dev/null || return 1
  s=$(networkctl list --no-legend --no-pager 2>/dev/null | awk -v i="$1" '$2 == i { print $5 }')
  [ -n "$s" ] && [ "$s" != unmanaged ]
}

# How the card was connected before the first activation: kept in $ETC/origine until the old
# connection is back. Never overwritten while it exists (a second activation must not record the
# access point itself as the « origin »).
sauver_origine() {
  [ -f "$ETC/origine" ] && return 0
  local g=aucun connexion= route=non wpa=non
  porte_route "$INTERFACE" && route=oui
  if nm_gere "$INTERFACE"; then
    g=nm
    connexion=$(nmcli -t -f UUID,DEVICE connection show --active 2>/dev/null | awk -F: -v i="$INTERFACE" '$2 == i { print $1; exit }')
  elif networkd_gere "$INTERFACE"; then
    g=networkd
    [ "$(systemctl show -p LoadState --value "netplan-wpa-$INTERFACE.service" 2>/dev/null)" = loaded ] && wpa=oui
  fi
  printf 'GESTIONNAIRE=%q\nCONNEXION=%q\nROUTE=%q\nWPA=%q\n' "$g" "$connexion" "$route" "$wpa" > "$ETC/origine"
  chmod 600 "$ETC/origine"
}

charger_origine() {
  GESTIONNAIRE=aucun; CONNEXION=; ROUTE=non; WPA=non
  # shellcheck disable=SC1091
  [ -f "$ETC/origine" ] && . "$ETC/origine"
  return 0
}

# The card leaves its manager (at each start, boot included). Declarations kept while the access
# point is wanted: at boot, the manager would otherwise take the card and rejoin a saved network.
prendre_carte() {
  charger_origine
  if nm_actif; then
    mkdir -p "$(dirname "$NM_CONF")"
    # A [device-…] section with managed=0, not keyfile.unmanaged-devices: Ubuntu's list holds
    # « except:type:wifi », and an except: spec wins over the whole list
    printf '# ODIN : interface du point d'"'"'accès Wi-Fi, laissée à scripts/point-acces.sh\n[device-odin-point-acces]\nmatch-device=interface-name:%s\nmanaged=0\n' "$INTERFACE" > "$NM_CONF"
    nmcli general reload conf 2>/dev/null || systemctl reload NetworkManager 2>/dev/null
    nmcli device set "$INTERFACE" managed no 2>/dev/null
  fi
  if [ "$GESTIONNAIRE" = networkd ]; then
    # 00- sorts before netplan's 10-netplan-<if>.network, and /etc wins over /run: first match
    mkdir -p "$(dirname "$NETWORKD_CONF")"
    printf '# ODIN : interface du point d'"'"'accès Wi-Fi, laissée à scripts/point-acces.sh\n[Match]\nName=%s\n\n[Link]\nUnmanaged=yes\n' "$INTERFACE" > "$NETWORKD_CONF"
    # Never a daemon-reload here (nor mask, enable or disable without --no-reload): it makes netplan's
    # generator rewrite every .network file, and the next « networkctl reload » then reconfigures the
    # Ethernet too (DHCP lease renewed; seen on the test VM). A reload alone touches changed files only.
    networkctl reload 2>/dev/null
    if [ "$WPA" = oui ]; then
      # netplan's wpa_supplicant must not start at boot while the card is taken: a condition in a
      # drop-in (read at boot), instead of a mask (which needs a daemon-reload to be undone)
      mkdir -p "$SYSTEMD/netplan-wpa-$INTERFACE.service.d"
      printf '# ODIN : carte prise par le point d'"'"'accès Wi-Fi\n[Unit]\nConditionPathExists=!%s\n' "$ETC/carte-prise" > "$SYSTEMD/netplan-wpa-$INTERFACE.service.d/odin-point-acces.conf"
      touch "$ETC/carte-prise"
      systemctl stop "netplan-wpa-$INTERFACE.service" 2>/dev/null
    fi
  fi
  return 0
}

# The card goes back to its manager, which rejoins the saved network
rendre_carte() {
  charger_origine
  if [ -f "$NM_CONF" ]; then
    rm -f "$NM_CONF"
    if nm_actif; then
      nmcli general reload conf 2>/dev/null || systemctl reload NetworkManager 2>/dev/null
      nmcli device set "$INTERFACE" managed yes 2>/dev/null
    fi
  fi
  if [ "$GESTIONNAIRE" = nm ] && [ -n "$CONNEXION" ] && nm_actif; then
    # --wait 0: the request only (a process left behind would be killed with the unit); the
    # caller waits for the route itself
    timeout 10 nmcli --wait 0 connection up uuid "$CONNEXION" >/dev/null 2>&1
  fi
  if [ -f "$NETWORKD_CONF" ] || [ "$GESTIONNAIRE" = networkd ]; then
    rm -f "$NETWORKD_CONF" "$ETC/carte-prise" "$SYSTEMD/netplan-wpa-$INTERFACE.service.d/odin-point-acces.conf"
    rmdir "$SYSTEMD/netplan-wpa-$INTERFACE.service.d" 2>/dev/null
    networkctl reload 2>/dev/null
    # The condition is checked at start: without carte-prise, netplan's wpa_supplicant starts again
    [ "$WPA" = oui ] && systemctl start "netplan-wpa-$INTERFACE.service" 2>/dev/null
    networkctl reconfigure "$INTERFACE" 2>/dev/null
  fi
  return 0
}

# --- Start and stop (units) -----------------------------------------------------------------------

demarrer() {
  charger_parametres || return 1
  [ -n "$INTERFACE" ] || { echo "Aucune interface choisie : activez depuis le tableau de bord." >&2; return 1; }
  iw dev "$INTERFACE" info >/dev/null 2>&1 || { echo "Interface Wi-Fi $INTERFACE introuvable." >&2; return 1; }
  install -d -m 700 "$RUN"
  rfkill unblock wifi 2>/dev/null
  prendre_carte
  local canal; canal=$(choisir_canal "$INTERFACE")
  echo "$canal" > "$RUN/canal"
  ip link set "$INTERFACE" down
  ip -4 addr flush dev "$INTERFACE"
  ip route flush dev "$INTERFACE" 2>/dev/null
  sysctl -q -w "net.ipv6.conf.$INTERFACE.disable_ipv6=1"
  ip addr add "$RESEAU" dev "$INTERFACE" || return 1
  ip link set "$INTERFACE" up
  poser_pare_feu || { echo "Pare-feu : règle impossible à poser, point d'accès non démarré." >&2; arreter; return 1; }
  remplir "$ETC/hostapd.conf" CANAL "$canal" > "$RUN/hostapd.conf.tmp" && chmod 600 "$RUN/hostapd.conf.tmp" \
    && mv -f "$RUN/hostapd.conf.tmp" "$RUN/hostapd.conf"
  echo "Point d'accès : $INTERFACE, $ADRESSE, canal $canal, pays $PAYS_CODE"
}

# Stop of the network unit: address, IPv6 and firewall undone. The card stays out of its manager:
# only desactiver (or the fallback) gives it back.
arreter() {
  charger_parametres || return 0
  [ -n "$INTERFACE" ] || return 0
  retirer_pare_feu
  ip -4 addr del "$RESEAU" dev "$INTERFACE" 2>/dev/null
  ip link set "$INTERFACE" down 2>/dev/null
  sysctl -q -w "net.ipv6.conf.$INTERFACE.disable_ipv6=0" 2>/dev/null
  rm -f "$RUN/hostapd.conf" "$RUN/canal"
  return 0
}

# Main process running: « active », or still in its ExecStartPost (the other service's check runs
# while this one is not « active » yet; waiting for « active » would make them wait for each other)
en_marche() {
  local e; e=$(systemctl show -p ActiveState -p SubState --value "$1" 2>/dev/null | tr '\n' ' ')
  [[ "$e" == "active "* || "$e" == *" start-post "* ]]
}

# ExecStartPost of hostapd and dnsmasq: « actif » once both run and the card is an access point
etat_demarrage() {
  charger_parametres || return 0
  local i
  for i in $(seq 20); do
    if en_marche odin-hostapd.service && en_marche odin-dnsmasq.service \
      && iw dev "$INTERFACE" info 2>/dev/null | grep -q 'type AP'; then
      ecrire_etat actif; return 0
    fi
    sleep 0.5
  done
  return 0
}

# --- Actions --------------------------------------------------------------------------------------

# One action at a time (dashboard requests, units, installer)
verrouiller() { exec 9>"$VERROU" && flock -w "${1:-180}" 9; }

arreter_unites() {
  systemctl disable --no-reload odin-point-acces.target >/dev/null 2>&1
  systemctl stop odin-point-acces.target odin-hostapd.service odin-dnsmasq.service odin-point-acces-reseau.service 2>/dev/null
  systemctl reset-failed odin-hostapd.service odin-dnsmasq.service odin-point-acces-reseau.service odin-point-acces-echec.service 2>/dev/null
}

# Starts the units and waits up to DELAI seconds for the access point to emit
lancer_et_verifier() {
  systemctl reset-failed odin-hostapd.service odin-dnsmasq.service odin-point-acces-reseau.service odin-point-acces-echec.service 2>/dev/null
  systemctl start --no-block odin-point-acces.target
  local i
  for i in $(seq "$DELAI"); do
    sleep 1
    emet && return 0
  done
  return 1
}

# What did not work, for the error message
cause_echec() {
  local c=()
  systemctl is-active --quiet odin-point-acces-reseau.service || c+=("réseau de la carte")
  systemctl is-active --quiet odin-hostapd.service || c+=("hostapd")
  systemctl is-active --quiet odin-dnsmasq.service || c+=("dnsmasq")
  iw dev "$INTERFACE" info 2>/dev/null | grep -q 'type AP' || c+=("carte pas en mode point d'accès")
  local IFS=,; echo "${c[*]:-inconnue}" | sed 's/,/, /g'
}

# Back to the connection of before: units stopped, card given back, nothing wanted any more
retour() {
  arreter_unites
  rendre_carte
  rm -f "$ETC/voulu" "$ETC/origine"
}

# $1: « --installeur » refuses a card that carries the default route (install.sh never cuts the
# connection it is running on); the dashboard may, after its warnings.
activer() {
  local mode=${1:-}
  verrouiller || { echo "Une autre action du point d'accès est en cours." >&2; return 1; }
  lire_config
  charger_parametres || return 1
  noter_action activer en-cours; ecrire_etat
  IF_IMPOSEE=${IF_IMPOSEE:-}
  # The card of an access point already running stays the one
  if voulu_actif && [ -n "$INTERFACE" ] && emet; then noter_action activer ok; ecrire_etat; echo "Point d'accès déjà actif."; return 0; fi
  detecter
  if [ -n "$DET_RAISON" ]; then
    noter_erreur "Activation impossible : $(message_raison "$DET_RAISON" "$DET_IF")"
    noter_action activer echec; ecrire_etat; return 1
  fi
  if [ "$mode" = --installeur ] && [ "$DET_ROUTE" = oui ]; then
    noter_erreur "Activation refusée : $(message_raison wifi-occupe "$DET_IF")"
    noter_action activer echec; ecrire_etat; return 1
  fi
  INTERFACE=$DET_IF; PAYS_CODE=$DET_PAYS
  generer_configurations
  sauver_origine
  if lancer_et_verifier; then
    echo actif > "$ETC/voulu"
    systemctl enable --no-reload odin-point-acces.target >/dev/null 2>&1
    noter_action activer ok; ecrire_etat
    echo "Réseau Wi-Fi : $SSID, mot de passe : $(<"$ETC/mot-de-passe") (adresse : http://$ADRESSE)"
    return 0
  fi
  local cause; cause=$(cause_echec)
  retour
  noter_erreur "Le point d'accès n'émettait pas après $DELAI s ($cause) : retour automatique à l'ancienne connexion."
  noter_action activer echec; ecrire_etat; return 1
}

# Waits up to DELAI seconds for the default route to come back on the card
attendre_route() {
  local i
  for i in $(seq "$DELAI"); do
    porte_route "$INTERFACE" && return 0
    sleep 1
  done
  return 1
}

desactiver() {
  verrouiller || { echo "Une autre action du point d'accès est en cours." >&2; return 1; }
  lire_config
  charger_parametres || return 1
  noter_action desactiver en-cours; ecrire_etat
  if [ -z "$INTERFACE" ] || { ! voulu_actif && [ ! -f "$ETC/origine" ] && ! emet; }; then
    arreter_unites; rm -f "$ETC/voulu"
    noter_action desactiver ok; ecrire_etat; echo "Point d'accès déjà désactivé."; return 0
  fi
  charger_origine
  local route=$ROUTE
  arreter_unites
  rendre_carte
  if [ "$route" = oui ] && ! attendre_route; then
    # Never left without any network: the access point comes back so the machine stays reachable
    if lancer_et_verifier_repli; then
      noter_erreur "L'ancienne connexion Wi-Fi n'est pas revenue en $DELAI s (box absente ou mot de passe changé) : point d'accès réactivé pour que la machine reste joignable."
    else
      noter_erreur "L'ancienne connexion Wi-Fi n'est pas revenue en $DELAI s, et le point d'accès n'a pas pu être réactivé : la machine n'a plus de réseau Wi-Fi."
    fi
    noter_action desactiver echec; ecrire_etat; return 1
  fi
  rm -f "$ETC/voulu" "$ETC/origine"
  noter_action desactiver ok; ecrire_etat
  if [ "$route" = oui ]; then echo "Point d'accès désactivé : connexion Wi-Fi d'origine revenue."; else echo "Point d'accès désactivé."; fi
}

# The card taken again for the access point (origin kept), wanted again
lancer_et_verifier_repli() {
  generer_configurations
  if lancer_et_verifier; then
    echo actif > "$ETC/voulu"
    systemctl enable --no-reload odin-point-acces.target >/dev/null 2>&1
    return 0
  fi
  arreter_unites
  return 1
}

# OnFailure of the units (at boot or later): hostapd, dnsmasq or the network setup gave up. The access
# point was wanted: back to the old connection, the error recorded.
echec() {
  verrouiller || return 0
  lire_config
  charger_parametres || return 0
  if voulu_actif && ! emet; then
    local cause; cause=$(cause_echec)
    retour
    noter_erreur "Le point d'accès s'est arrêté ($cause) : retour automatique à l'ancienne connexion."
    noter_action demarrage echec
  fi
  ecrire_etat
}

# Request of the dashboard: data/config/point-acces-demande holds « activer » or « desactiver ». Read
# as data only (never passed to a shell), removed first; anything else is ignored and logged.
demande() {
  lire_config
  charger_parametres || return 0
  local f="$DATA/config/point-acces-demande" contenu
  if [ -L "$f" ]; then rm -f "$f"; echo "Demande ignorée : lien symbolique." >&2; return 0; fi
  if [ -d "$f" ]; then mv -f "$f" "$f.ignoree-$(date +%s)"; echo "Demande ignorée : dossier." >&2; return 0; fi
  [ -f "$f" ] || return 0
  contenu=$(head -c 32 "$f" | tr -d '[:space:]')
  rm -f "$f"
  case "$contenu" in
    activer) activer ;;
    desactiver) desactiver ;;
    *) echo "Demande ignorée : « ${contenu//[^a-z-]/?} » n'est pas une action connue." >&2 ;;
  esac
  return 0
}

etat() {
  lire_config
  charger_parametres 2>/dev/null || true
  ecrire_etat
  cat "$DATA/config/point-acces.json" 2>/dev/null
}

# --- Installation ---------------------------------------------------------------------------------

# Every installation (install.sh): packages already there, files, password, units. Nothing started,
# except an access point that was active (its files regenerated, restarted if they changed).
installer() {
  lire_config
  install -d -m 700 "$ETC"
  local ancienne= ancien_if=
  if [ -f "$ETC/parametres" ]; then
    ancienne=$(sed -n 's/^RESEAU=//p' "$ETC/parametres" | tr -d "'\"")
    ancien_if=$(sed -n 's/^INTERFACE=//p' "$ETC/parametres" | tr -d "'\"")
    PAYS_CODE=$(sed -n 's/^PAYS_CODE=//p' "$ETC/parametres" | tr -d "'\"")
  fi
  # Range: the running access point keeps its own (its route does not count)
  choisir_plage "$ancienne" "$ancien_if"
  [ -n "$PLAGE_RAISON" ] && echo "Point d'accès Wi-Fi : $(message_raison "$PLAGE_RAISON")"
  if [ ${#SSID} -gt 32 ] || [[ "$SSID" == *$'\n'* ]]; then echo "POINT_ACCES_SSID trop long (32 octets au plus) : ODIN gardé."; SSID=ODIN; fi
  [ -s "$ETC/mot-de-passe" ] || { generer_mot_de_passe > "$ETC/mot-de-passe"; chmod 600 "$ETC/mot-de-passe"; }
  INTERFACE=$ancien_if; PAYS_CODE=${PAYS_CODE:-$(pays)}
  ecrire_parametres

  # daemon-reload only when a unit changed: every daemon-reload makes netplan rewrite its .network
  # files, and the next « networkctl reload » of a switch would then renew the Ethernet lease
  local f recharger=
  for f in "${UNITES[@]}"; do
    ecrire_si_change "$SYSTEMD/$f" "$(remplir "$MODELES/$f" SCRIPT "$SCRIPT" RUN "$RUN" ETC "$ETC" DATA "$DATA")" 644 && recharger=1
  done
  # The distribution's hostapd stays masked: ODIN starts its own
  if [ "$(systemctl is-enabled hostapd.service 2>/dev/null)" != masked ]; then systemctl mask --no-reload hostapd.service >/dev/null 2>&1; recharger=1; fi
  [ -n "$recharger" ] && systemctl daemon-reload
  systemctl enable --no-reload odin-point-acces-etat.service odin-point-acces-demande.path >/dev/null 2>&1
  systemctl start odin-point-acces-demande.path 2>/dev/null

  # Lots 1 and 2 enabled the target at installation: that access point stays wanted
  if [ ! -f "$ETC/voulu" ] && systemctl is-enabled --quiet odin-point-acces.target 2>/dev/null; then echo actif > "$ETC/voulu"; fi

  # QR codes next to the state: joining the network, then opening ODIN
  if command -v qrencode >/dev/null && [ -d "$DATA/config" ]; then
    local proprio mdp; proprio=$(stat -c %u:%g "$DATA/config"); mdp=$(<"$ETC/mot-de-passe")
    qrencode -t SVG -o "$DATA/config/point-acces-wifi.svg" "WIFI:T:WPA;S:$(echapper_qr "$SSID");P:$(echapper_qr "$mdp");;"
    qrencode -t SVG -o "$DATA/config/point-acces-adresse.svg" "http://$ADRESSE/"
    chown "$proprio" "$DATA/config"/point-acces-*.svg
  fi

  decouper_reseau "$RESEAU"
  if voulu_actif && [ -n "$INTERFACE" ]; then
    verrouiller || return 0
    if generer_configurations || ! emet; then
      echo "Point d'accès Wi-Fi actif : redémarrage avec la nouvelle configuration."
      if ! lancer_et_verifier; then
        local cause; cause=$(cause_echec)
        retour
        noter_erreur "Le point d'accès n'a pas redémarré après la mise à jour ($cause) : retour automatique à l'ancienne connexion."
        noter_action mise-a-jour echec
      fi
    fi
    exec 9>&-
  fi
  ecrire_etat
  resume
}

# Units stopped and removed, card given back to its manager
desinstaller() {
  lire_config
  if [ -f "$ETC/parametres" ]; then
    charger_parametres
    arreter_unites
    if [ -n "$INTERFACE" ]; then
      retirer_pare_feu
      ip -4 addr del "$RESEAU" dev "$INTERFACE" 2>/dev/null
      sysctl -q -w "net.ipv6.conf.$INTERFACE.disable_ipv6=0" 2>/dev/null
      rendre_carte
    fi
  fi
  systemctl disable --now odin-point-acces-demande.path odin-point-acces-etat.service >/dev/null 2>&1
  local f; for f in "${UNITES[@]}"; do rm -f "$SYSTEMD/$f"; done
  systemctl daemon-reload
  systemctl reset-failed "${UNITES[@]}" 2>/dev/null
  rm -rf "$ETC" "$RUN"
  rmdir "$(dirname "$ETC")" 2>/dev/null
  rm -f "$DATA/config"/point-acces-*.svg "$DATA/config/point-acces.json" "$DATA/config/point-acces-demande"
  echo "Point d'accès Wi-Fi retiré."
}

# Variables of the captive portal (Caddy and dashboard), for .env: printed once the range is valid,
# whatever the state of the access point (it can be activated from the dashboard at any time).
portail() {
  lire_config
  [ -f "$ETC/parametres" ] && RESEAU=$(sed -n 's/^RESEAU=//p' "$ETC/parametres" | tr -d "'\"")
  decouper_reseau "$RESEAU" || return 0
  local itf=
  [ -f "$ETC/parametres" ] && itf=$(sed -n 's/^INTERFACE=//p' "$ETC/parametres" | tr -d "'\"")
  plage_occupee "$itf" && return 0
  local hotes="$ADRESSE $NOM $NOM.lan"
  systemctl is-active --quiet avahi-daemon 2>/dev/null && hotes+=" $NOM.local"
  echo "PORTAIL_RESEAU=$CIDR"
  echo "PORTAIL_HOTES=\"$hotes\""
}

# One line for the end of the installer
resume() {
  local f="$DATA/config/point-acces.json" etat raison
  [ -f "$f" ] || return 0
  etat=$(sed -n 's/^  "etat": "\(.*\)",/\1/p' "$f")
  raison=$(sed -n 's/^  "raison": "\(.*\)",/\1/p' "$f")
  case "$etat" in
    actif) echo "Point d'accès Wi-Fi actif : réseau $SSID, mot de passe $(cat "$ETC/mot-de-passe" 2>/dev/null)" ;;
    indisponible) echo "Point d'accès Wi-Fi indisponible : $(message_raison "$raison" "$(sed -n 's/^  "interface": "\(.*\)",/\1/p' "$f")")" ;;
    *) echo "Point d'accès Wi-Fi désactivé (à activer depuis le tableau de bord, page Point d'accès Wi-Fi)." ;;
  esac
}

principal() {
  case "${1:-}" in
    detecter)
      lire_config; decouper_reseau "$RESEAU" || { echo "POINT_ACCES_RESEAU invalide : $RESEAU"; return 1; }
      [ -f "$ETC/parametres" ] && charger_parametres
      detecter
      if [ -z "$DET_RAISON" ]; then
        echo "Utilisable : $DET_IF ($DET_PHY), pays $DET_PAYS$([ "$DET_ROUTE" = oui ] && echo ", porte la connexion à internet (coupée à l'activation)")"
      else message_raison "$DET_RAISON" "$DET_IF"; fi ;;
    activer) activer "${2:-}" ;;
    desactiver) desactiver ;;
    etat) if [ "${2:-}" = --ecrire ]; then etat_demarrage; else etat; fi ;;
    installer) installer ;;
    desinstaller) desinstaller ;;
    demarrer) demarrer ;;
    arreter) arreter ;;
    echec) echec ;;
    demande) demande ;;
    portail) portail ;;
    resume) lire_config; charger_parametres 2>/dev/null; etat >/dev/null; resume ;;
    *) echo "Usage : sudo $0 activer|desactiver|etat|detecter"; return 1 ;;
  esac
}

# Sourced by the tests: functions only
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "$(id -u)" -ne 0 ]; then echo "Lancez ce script avec sudo."; exit 1; fi
  principal "$@"
fi

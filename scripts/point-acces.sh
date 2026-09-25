#!/usr/bin/env bash
# ODIN access point (option POINT_ACCES): the machine creates its own Wi-Fi network, hostapd and
# dnsmasq on the host, under systemd (docs/conception-point-acces.md, lot 1).
#
#   sudo scripts/point-acces.sh detecter      Wi-Fi card usable? (nothing changed)
#   sudo scripts/point-acces.sh installer     configuration, units, start (called by install.sh)
#   sudo scripts/point-acces.sh desinstaller  everything removed, interface given back to the system
#   scripts/point-acces.sh etat               state (JSON)
#   demarrer, arreter, echec                  called by the systemd units only
#
# Only the Wi-Fi interface is touched: Ethernet, netplan, systemd-resolved and Docker's own settings
# stay as they are. A failure never stops the installer: the state says why.
set -uo pipefail
shopt -u patsub_replacement 2>/dev/null || true

CIBLE=${POINT_ACCES_CIBLE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
SCRIPT="$CIBLE/scripts/point-acces.sh"
MODELES="$CIBLE/config/point-acces"
ETC=${POINT_ACCES_ETC:-/etc/odin/point-acces}
RUN=${POINT_ACCES_RUN:-/run/odin-point-acces}
SYSTEMD=${POINT_ACCES_SYSTEMD:-/etc/systemd/system}
NM_CONF=${POINT_ACCES_NM_CONF:-/etc/NetworkManager/conf.d/odin-point-acces.conf}
ZONE_TAB=${ZONE_TAB:-/usr/share/zoneinfo/zone.tab}
UNITES=(odin-point-acces.target odin-point-acces-reseau.service odin-hostapd.service odin-dnsmasq.service odin-point-acces-echec.service)
# Passwords: lower case and digits, without 0/o/1/l
ALPHABET=abcdefghijkmnpqrstuvwxyz23456789

# --- Configuration -------------------------------------------------------------------------------

# Value of a key in .env (last one wins), without executing the file
valeur_env() { sed -n "s/^$1=//p" "$CIBLE/.env" 2>/dev/null | tail -1 | sed 's/^"\(.*\)"$/\1/'; }

# .env, overridden by the environment (tests), then the defaults of the brief
lire_config() {
  IF_IMPOSEE=${POINT_ACCES_INTERFACE-$(valeur_env POINT_ACCES_INTERFACE)}
  SSID=${POINT_ACCES_SSID-$(valeur_env POINT_ACCES_SSID)}; SSID=${SSID:-ODIN}
  RESEAU=${POINT_ACCES_RESEAU-$(valeur_env POINT_ACCES_RESEAU)}; RESEAU=${RESEAU:-10.42.0.1/24}
  PAYS_IMPOSE=${PAYS-$(valeur_env PAYS)}
  local d; d=$(valeur_env DATA_DIR); d=${d:-./data}
  case "$d" in /*) DATA=$d ;; *) DATA="$CIBLE/${d#./}" ;; esac
  DATA=${POINT_ACCES_DATA:-$DATA}
  NOM=$(hostname)
}

# --- Addresses ------------------------------------------------------------------------------------

ip_en_nombre() { local IFS=.; set -- $1; echo $(( ($1 << 24) + ($2 << 16) + ($3 << 8) + $4 )); }
nombre_en_ip() { echo "$(( $1 >> 24 & 255 )).$(( $1 >> 16 & 255 )).$(( $1 >> 8 & 255 )).$(( $1 & 255 ))"; }
masque_de() { echo $(( $1 == 0 ? 0 : (0xFFFFFFFF << (32 - $1)) & 0xFFFFFFFF )); }

# 10.42.0.1/24 → ADRESSE, PREFIXE, MASQUE, DEBUT (.10), FIN (.250) ; false when invalid
decouper_reseau() {
  [[ "$1" =~ ^([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/([0-9]{1,2})$ ]] || return 1
  ADRESSE=${BASH_REMATCH[1]}; PREFIXE=${BASH_REMATCH[2]}
  (( PREFIXE >= 16 && PREFIXE <= 24 )) || return 1
  local n m base
  n=$(ip_en_nombre "$ADRESSE"); m=$(masque_de "$PREFIXE"); base=$(( n & m ))
  MASQUE=$(nombre_en_ip "$m")
  DEBUT=$(nombre_en_ip $(( base + 10 )))
  FIN=$(nombre_en_ip $(( base + 250 )))
}

# Another interface already routes part of this range (a box on 10.42.x.x, a VPN…)
plage_occupee() {
  local n p m ligne dest pd md autre
  n=$(ip_en_nombre "$ADRESSE"); p=$PREFIXE
  while read -r ligne; do
    dest=${ligne%% *}
    autre=$(sed -n 's/.* dev \([^ ]*\).*/\1/p' <<<"$ligne")
    [ "$dest" = default ] && continue
    [ -n "${1:-}" ] && [ "$autre" = "$1" ] && continue
    [[ "$dest" == */* ]] || dest="$dest/32"
    pd=${dest#*/}
    md=$(masque_de $(( pd < p ? pd : p )))
    (( ( $(ip_en_nombre "${dest%/*}") & md ) == ( n & md ) )) && return 0
  done < <(ip -4 route show 2>/dev/null)
  return 1
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

# Default route, IPv4 address (other than ours) or connection to a network: already in use
interface_occupee() {
  local a
  [ -n "$(ip route show default dev "$1" 2>/dev/null)" ] && return 0
  a=$(ip -4 -o addr show dev "$1" 2>/dev/null | awk '{ split($4, x, "/"); print x[1] }' | grep -vx "${ADRESSE:-}")
  [ -n "$a" ] && return 0
  iw dev "$1" link 2>/dev/null | grep -q '^Connected to' && return 0
  return 1
}

# PAYS, else the time zone looked up in zone.tab (Europe/Brussels → BE), else 00 (world domain:
# channels 1, 6 and 11 are allowed there)
pays() {
  local p=${PAYS_IMPOSE:-} fuseau
  if [[ "${p^^}" =~ ^[A-Z]{2}$ ]]; then echo "${p^^}"; return; fi
  fuseau=$(timedatectl show -p Timezone --value 2>/dev/null)
  p=$(awk -F'\t' -v f="$fuseau" '$1 !~ /^#/ && $3 == f { print $1; exit }' "$ZONE_TAB" 2>/dev/null)
  echo "${p:-00}"
}

# Sets DET_IF, DET_PHY, DET_PAYS and DET_RAISON (empty when the card can be used)
detecter() {
  DET_IF=; DET_PHY=; DET_RAISON=; DET_PAYS=$(pays)
  local liste itf phy
  liste=$(interfaces_wifi)
  if [ -n "$IF_IMPOSEE" ]; then liste=$(awk -v i="$IF_IMPOSEE" '$1 == i' <<<"$liste"); fi
  if [ -z "$liste" ]; then DET_RAISON=aucune-carte; DET_IF=$IF_IMPOSEE; return; fi
  # The first free card that can be an access point
  DET_RAISON=pas-de-mode-ap
  while read -r itf phy; do
    mode_ap "$phy" || continue
    if interface_occupee "$itf"; then DET_RAISON=wifi-occupe; DET_IF=${DET_IF:-$itf}; continue; fi
    DET_IF=$itf; DET_PHY=$phy; DET_RAISON=; break
  done <<<"$liste"
  [ -z "$DET_IF" ] && DET_IF=$(awk 'NR == 1 { print $1 }' <<<"$liste")
  if [ -z "$DET_RAISON" ] && plage_occupee "$DET_IF"; then DET_RAISON=plage-occupee; fi
}

message_raison() {
  case "$1" in
    aucune-carte) [ -n "${2:-}" ] && echo "Interface Wi-Fi $2 introuvable." || echo "Aucune carte Wi-Fi détectée." ;;
    pas-de-mode-ap) echo "La carte Wi-Fi ${2:-} ne sait pas créer de point d'accès." ;;
    wifi-occupe) echo "La carte Wi-Fi ${2:-} sert déjà à la connexion de cette machine : utilisez l'Ethernet pour la préparation." ;;
    plage-occupee) echo "La plage $RESEAU est déjà utilisée par une autre interface : choisissez-en une autre avec POINT_ACCES_RESEAU dans .env." ;;
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

# --- State ----------------------------------------------------------------------------------------

# data/config/point-acces.json, read by the dashboard (lot 2). 640, owner of data/config: the
# dashboard container runs as root and reads it.
ecrire_etat() {
  local etat=$1 raison=${2:-} fichier="$DATA/config/point-acces.json" noms canal=null mdp=
  [ -d "$DATA/config" ] || return 0
  [ -f "$ETC/mot-de-passe" ] && mdp=$(<"$ETC/mot-de-passe")
  [ -f "$RUN/canal" ] && canal=$(<"$RUN/canal")
  noms="[$(echapper_json "$NOM.lan")"
  systemctl is-active --quiet avahi-daemon 2>/dev/null && noms+=", $(echapper_json "$NOM.local")"
  noms+="]"
  local tmp; tmp=$(mktemp "$DATA/config/.point-acces.XXXXXX") || return 0
  cat > "$tmp" <<EOF
{
  "etat": "$etat",
  "raison": $(json_ou_null "$raison"),
  "interface": $(json_ou_null "${INTERFACE:-${DET_IF:-}}"),
  "ssid": $(echapper_json "$SSID"),
  "motDePasse": $(json_ou_null "$mdp"),
  "adresse": $(json_ou_null "${ADRESSE:-}"),
  "noms": $noms,
  "canal": $canal,
  "pays": $(json_ou_null "${PAYS_CODE:-${DET_PAYS:-}}"),
  "maj": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  chown "$(stat -c %u:%g "$DATA/config")" "$tmp" && chmod 640 "$tmp" && mv -f "$tmp" "$fichier"
}

# Parameters fixed at installation, read by the units (never .env at start)
charger_parametres() {
  [ -f "$ETC/parametres" ] || { echo "Point d'accès non installé ($ETC/parametres absent)." >&2; return 1; }
  # shellcheck disable=SC1091
  . "$ETC/parametres"
  decouper_reseau "$RESEAU"
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

# --- NetworkManager -------------------------------------------------------------------------------

nm_actif() { systemctl is-active --quiet NetworkManager 2>/dev/null; }

nm_liberer() {
  nm_actif || return 0
  mkdir -p "$(dirname "$NM_CONF")"
  # « += » adds to the list of the distribution (Ubuntu leaves everything but Wi-Fi unmanaged);
  # « = » would replace it and hand Ethernet and Docker's bridges to NetworkManager
  printf '# ODIN : interface du point d'"'"'accès Wi-Fi, laissée à scripts/point-acces.sh\n[keyfile]\nunmanaged-devices+=interface-name:%s\n' "$INTERFACE" > "$NM_CONF"
  nmcli general reload conf 2>/dev/null || systemctl reload NetworkManager 2>/dev/null
  nmcli device set "$INTERFACE" managed no 2>/dev/null
  return 0
}

nm_rendre() {
  [ -f "$NM_CONF" ] || return 0
  rm -f "$NM_CONF"
  nm_actif || return 0
  nmcli general reload conf 2>/dev/null || systemctl reload NetworkManager 2>/dev/null
  nmcli device set "$INTERFACE" managed yes 2>/dev/null
  return 0
}

# --- Start and stop (units) -----------------------------------------------------------------------

demarrer() {
  charger_parametres || return 1
  install -d -m 700 "$RUN"
  rfkill unblock wifi 2>/dev/null
  nm_liberer
  local canal; canal=$(choisir_canal "$INTERFACE")
  echo "$canal" > "$RUN/canal"
  ip link set "$INTERFACE" down
  ip -4 addr flush dev "$INTERFACE"
  sysctl -q -w "net.ipv6.conf.$INTERFACE.disable_ipv6=1"
  ip addr add "$RESEAU" dev "$INTERFACE" || return 1
  ip link set "$INTERFACE" up
  poser_pare_feu || { echo "Pare-feu : règle impossible à poser, point d'accès non démarré." >&2; arreter; return 1; }
  remplir "$ETC/hostapd.conf" CANAL "$canal" > "$RUN/hostapd.conf.tmp" && chmod 600 "$RUN/hostapd.conf.tmp" \
    && mv -f "$RUN/hostapd.conf.tmp" "$RUN/hostapd.conf"
  echo "Point d'accès : $INTERFACE, $ADRESSE, canal $canal, pays $PAYS_CODE"
}

arreter() {
  charger_parametres || return 0
  retirer_pare_feu
  ip -4 addr del "$RESEAU" dev "$INTERFACE" 2>/dev/null
  ip link set "$INTERFACE" down 2>/dev/null
  sysctl -q -w "net.ipv6.conf.$INTERFACE.disable_ipv6=0" 2>/dev/null
  nm_rendre
  rm -f "$RUN/hostapd.conf" "$RUN/canal"
  lire_config_donnees
  ecrire_etat inactif
  return 0
}

# DATA and NOM for the state file, from the parameters
lire_config_donnees() { DATA=${DATA:-}; NOM=$(hostname); }

# Main process running: « active », or still in its ExecStartPost (the other service's check runs
# while this one is not « active » yet; waiting for « active » would make them wait for each other)
en_marche() {
  local e; e=$(systemctl show -p ActiveState -p SubState --value "$1" 2>/dev/null | tr '\n' ' ')
  [[ "$e" == "active "* || "$e" == *" start-post "* ]]
}

# Called after hostapd or dnsmasq started: actif once both run and the card is an access point
etat_ecrire() {
  charger_parametres || return 0
  lire_config_donnees
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

echec() {
  charger_parametres || return 0
  lire_config_donnees
  ecrire_etat indisponible echec-demarrage
}

# --- Installation ---------------------------------------------------------------------------------

actif() { systemctl is-active --quiet odin-hostapd.service && systemctl is-active --quiet odin-dnsmasq.service; }

installer() {
  lire_config
  decouper_reseau "$RESEAU" || { echo "POINT_ACCES_RESEAU invalide : $RESEAU (attendu : 10.42.0.1/24, préfixe de 16 à 24)."; return 0; }
  # An existing installation keeps its interface while it exists, running or not: another card
  # would be picked otherwise, and the old one's address would make the range look « in use »
  if [ -z "$IF_IMPOSEE" ] && [ -f "$ETC/parametres" ]; then
    local ancien; ancien=$(sed -n 's/^INTERFACE=//p' "$ETC/parametres" | tr -d "'\"")
    interfaces_wifi | awk '{ print $1 }' | grep -qx "$ancien" && IF_IMPOSEE=$ancien
  fi
  detecter
  INTERFACE=$DET_IF; PAYS_CODE=$DET_PAYS
  if [ -n "$DET_RAISON" ]; then
    # Nothing new started; a previous installation stays as it was, stopped
    [ -f "$ETC/parametres" ] && desinstaller_unites
    ecrire_etat indisponible "$DET_RAISON"
    echo "Point d'accès Wi-Fi indisponible : $(message_raison "$DET_RAISON" "$DET_IF")"
    return 0
  fi
  if [ ${#SSID} -gt 32 ] || [[ "$SSID" == *$'\n'* ]]; then echo "POINT_ACCES_SSID trop long (32 octets au plus)."; return 0; fi

  install -d -m 700 "$ETC"
  [ -s "$ETC/mot-de-passe" ] || { generer_mot_de_passe > "$ETC/mot-de-passe"; chmod 600 "$ETC/mot-de-passe"; }
  local mdp; mdp=$(<"$ETC/mot-de-passe")
  local change=0 f pays_lignes
  # Country 00 (world domain) is not a country for hostapd: no country_code then
  if [ "$PAYS_CODE" = 00 ]; then pays_lignes="# Pays inconnu : domaine réglementaire mondial"; else pays_lignes="country_code=$PAYS_CODE"$'\n'"ieee80211d=1"; fi

  ecrire_si_change "$ETC/parametres" "$(printf 'INTERFACE=%q\nRESEAU=%q\nSSID=%q\nPAYS_CODE=%q\nDATA=%q\n' "$INTERFACE" "$RESEAU" "$SSID" "$PAYS_CODE" "$DATA")" 600 && change=1
  ecrire_si_change "$ETC/hostapd.conf" "$(remplir "$MODELES/hostapd.conf" INTERFACE "$INTERFACE" RUN "$RUN" SSID "$SSID" PAYS_LIGNES "$pays_lignes" MOT_DE_PASSE "$mdp")" 600 && change=1
  ecrire_si_change "$ETC/dnsmasq.conf" "$(remplir "$MODELES/dnsmasq.conf" INTERFACE "$INTERFACE" DEBUT "$DEBUT" FIN "$FIN" MASQUE "$MASQUE" ADRESSE "$ADRESSE" RUN "$RUN" NOM "$NOM")" 600 && change=1
  for f in "${UNITES[@]}"; do
    ecrire_si_change "$SYSTEMD/$f" "$(remplir "$MODELES/$f" SCRIPT "$SCRIPT" RUN "$RUN" ETC "$ETC")" 644 && change=1
  done

  # The distribution's hostapd stays masked: ODIN starts its own
  systemctl mask hostapd.service >/dev/null 2>&1
  systemctl daemon-reload
  systemctl enable odin-point-acces.target >/dev/null 2>&1

  # QR codes next to the state: joining the network, then opening ODIN
  if command -v qrencode >/dev/null && [ -d "$DATA/config" ]; then
    local proprio; proprio=$(stat -c %u:%g "$DATA/config")
    qrencode -t SVG -o "$DATA/config/point-acces-wifi.svg" "WIFI:T:WPA;S:$(echapper_qr "$SSID");P:$(echapper_qr "$mdp");;"
    qrencode -t SVG -o "$DATA/config/point-acces-adresse.svg" "http://$ADRESSE/"
    chown "$proprio" "$DATA/config"/point-acces-*.svg
  fi

  if [ "$change" = 1 ] || ! actif; then
    systemctl stop odin-hostapd.service odin-dnsmasq.service odin-point-acces-reseau.service 2>/dev/null
    systemctl reset-failed odin-hostapd.service odin-dnsmasq.service odin-point-acces-reseau.service 2>/dev/null
    systemctl start odin-point-acces.target
    local i; for i in $(seq 30); do actif && break; sleep 1; done
  fi
  if actif; then
    etat_ecrire
    echo "Réseau Wi-Fi : $SSID, mot de passe : $mdp (adresse : http://$ADRESSE)"
  else
    ecrire_etat indisponible echec-demarrage
    echo "Point d'accès Wi-Fi indisponible : $(message_raison echec-demarrage)"
  fi
  return 0
}

# Units stopped and removed; the interface goes back to the system (NetworkManager or netplan)
desinstaller_unites() {
  systemctl disable --now odin-point-acces.target >/dev/null 2>&1
  systemctl stop odin-hostapd.service odin-dnsmasq.service odin-point-acces-reseau.service 2>/dev/null
  local f; for f in "${UNITES[@]}"; do rm -f "$SYSTEMD/$f"; done
  systemctl daemon-reload
  systemctl reset-failed "${UNITES[@]}" 2>/dev/null
}

desinstaller() {
  lire_config
  decouper_reseau "$RESEAU" 2>/dev/null
  if [ -f "$ETC/parametres" ]; then
    # shellcheck disable=SC1091
    . "$ETC/parametres"; decouper_reseau "$RESEAU"
    desinstaller_unites
    # The stop undid the network; again in case the unit was already stopped or failed
    retirer_pare_feu
    ip -4 addr del "$RESEAU" dev "$INTERFACE" 2>/dev/null
    sysctl -q -w "net.ipv6.conf.$INTERFACE.disable_ipv6=0" 2>/dev/null
    nm_rendre
  else
    desinstaller_unites
  fi
  rm -rf "$ETC" "$RUN"
  rm -f "$DATA/config"/point-acces-*.svg
  ADRESSE=; ecrire_etat inactif
  echo "Point d'accès Wi-Fi retiré."
}

# One line for the end of the installer
resume() {
  lire_config
  local f="$DATA/config/point-acces.json" etat raison
  [ -f "$f" ] || return 0
  etat=$(sed -n 's/^  "etat": "\(.*\)",/\1/p' "$f")
  raison=$(sed -n 's/^  "raison": "\(.*\)",/\1/p' "$f")
  if [ "$etat" = actif ]; then
    echo "Réseau Wi-Fi : $SSID, mot de passe : $(cat "$ETC/mot-de-passe" 2>/dev/null)"
  elif [ -n "$raison" ]; then
    decouper_reseau "$RESEAU"
    echo "Point d'accès Wi-Fi indisponible : $(message_raison "$raison" "$(sed -n 's/^  "interface": "\(.*\)",/\1/p' "$f")")"
  fi
}

principal() {
  case "${1:-}" in
    detecter)
      lire_config; decouper_reseau "$RESEAU" || { echo "POINT_ACCES_RESEAU invalide : $RESEAU"; return 1; }
      detecter
      if [ -z "$DET_RAISON" ]; then echo "Utilisable : $DET_IF ($DET_PHY), pays $DET_PAYS"; else message_raison "$DET_RAISON" "$DET_IF"; fi ;;
    installer) installer ;;
    desinstaller) desinstaller ;;
    demarrer) demarrer ;;
    arreter) arreter ;;
    echec) echec ;;
    etat)
      if [ "${2:-}" = --ecrire ]; then etat_ecrire; else lire_config; cat "$DATA/config/point-acces.json" 2>/dev/null || echo '{"etat": "inactif"}'; fi ;;
    resume) resume ;;
    *) echo "Usage : sudo $0 detecter|installer|desinstaller|etat"; return 1 ;;
  esac
}

# Sourced by the tests: functions only
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "$(id -u)" -ne 0 ] && [ "${1:-}" != etat ] && [ "${1:-}" != resume ]; then echo "Lancez ce script avec sudo."; exit 1; fi
  principal "$@"
fi

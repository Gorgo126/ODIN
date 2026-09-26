#!/usr/bin/env bash
# Tests B of the access point with virtual radios (mac80211_hwsim), on a TEST VM only (never on the
# test server odintest: this touches the network and the firewall). docs/conception-point-acces.md.
#
#   sudo scripts/point-acces-test.sh preparer        hwsim (3 radios, also at boot), phone and box namespaces
#   sudo scripts/point-acces-test.sh connecter [mdp] the phone joins the network (password of ODIN by default)
#   sudo scripts/point-acces-test.sh verifier        points 1 to 5 of the brief, one line each
#   sudo scripts/point-acces-test.sh portail         point 6: captive portal, every probe before and after release
#   sudo scripts/point-acces-test.sh deconnecter
#   sudo scripts/point-acces-test.sh nettoyer        namespaces removed, hwsim no longer loaded at boot
set -uo pipefail

TEL=telephone
BOX=box
ETC=/etc/odin/point-acces
ETAT=/opt/odin/data/config/point-acces.json
[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }

dans() { ip netns exec "$TEL" "$@"; }
ok() { echo "  OK     $*"; }
ko() { echo "  ÉCHEC  $*"; ECHECS=$((ECHECS + 1)); }
ECHECS=0

# phy of a wlanN interface of the root namespace
phy_de() { iw dev "$1" info 2>/dev/null | awk '$1 == "wiphy" { print "phy" $2 }'; }
# Wi-Fi interface of a namespace
if_de() { ip netns exec "$1" iw dev 2>/dev/null | awk '$1 == "Interface" { print $2; exit }'; }

preparer() {
  # apt only when something is missing: after a cold restart offline, the namespaces must come back
  if ! modinfo mac80211_hwsim >/dev/null 2>&1 || ! command -v wpa_supplicant iw busybox >/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "linux-modules-extra-$(uname -r)" wpasupplicant iw busybox-static >/dev/null 2>&1 || { echo "Paquets impossibles à installer."; exit 1; }
  fi
  modinfo mac80211_hwsim >/dev/null 2>&1 || { echo "mac80211_hwsim introuvable : test impossible."; exit 1; }
  # Loaded at boot as well, for the cold restart test (test machine only)
  echo mac80211_hwsim > /etc/modules-load.d/odin-test-hwsim.conf
  echo "options mac80211_hwsim radios=3" > /etc/modprobe.d/odin-test-hwsim.conf
  lsmod | grep -q '^mac80211_hwsim' || modprobe mac80211_hwsim radios=3
  local ns itf
  for ns in "$TEL" "$BOX"; do
    ip netns list | grep -qw "$ns" && continue
    ip netns add "$ns"
  done
  # wlan1 → phone, wlan2 → box (lot 3); wlan0 stays for ODIN
  for couple in "wlan1:$TEL" "wlan2:$BOX"; do
    itf=${couple%%:*}; ns=${couple#*:}
    [ -n "$(if_de "$ns")" ] && continue
    iw phy "$(phy_de "$itf")" set netns name "$ns"
  done
  # Resolver of the phone: written from its DHCP lease (ip netns exec bind-mounts it)
  mkdir -p "/etc/netns/$TEL" && touch "/etc/netns/$TEL/resolv.conf"
  echo "Radios : ODIN $(iw dev | awk '$1 == "Interface" { print $2 }' | tr '\n' ' '), téléphone $(if_de "$TEL"), box $(if_de "$BOX")"
}

connecter() {
  local mdp=${1:-$(cat "$ETC/mot-de-passe")} ssid itf i
  ssid=$(sed -n 's/^ssid=//p' "$ETC/hostapd.conf")
  itf=$(if_de "$TEL")
  deconnecter >/dev/null 2>&1
  dans ip link set "$itf" up
  printf 'ctrl_interface=/run/wpa-%s\nnetwork={\n  ssid="%s"\n  psk="%s"\n  key_mgmt=WPA-PSK\n}\n' "$TEL" "$ssid" "$mdp" > "/run/wpa-$TEL.conf"
  dans wpa_supplicant -B -i "$itf" -c "/run/wpa-$TEL.conf" -P "/run/wpa-$TEL.pid" >/dev/null
  # Up to 30 s: after a wrong password, the next association takes longer
  for i in $(seq 60); do
    dans wpa_cli -p "/run/wpa-$TEL" -i "$itf" status 2>/dev/null | grep -q '^wpa_state=COMPLETED' && break
    sleep 0.5
  done
  if ! dans wpa_cli -p "/run/wpa-$TEL" -i "$itf" status 2>/dev/null | grep -q '^wpa_state=COMPLETED'; then
    echo "non-associé"; return 1
  fi
  # busybox udhcpc, once: lease applied, then what the server sent written to /run/bail-telephone.
  # Its script outside /run, which is mounted noexec
  mkdir -p /var/lib/odin-test
  cat > "/var/lib/odin-test/udhcpc-$TEL.sh" <<'SCRIPT'
#!/bin/sh
[ "$1" = bound ] || exit 0
ip -4 addr flush dev "$interface"
ip addr add "$ip/$mask" dev "$interface"
ip route replace default via "${router%% *}" dev "$interface"
printf 'ip=%s\nrouter=%s\ndns=%s\n' "$ip" "${router%% *}" "${dns%% *}" > /run/bail-telephone
echo "nameserver ${dns%% *}" > /etc/netns/telephone/resolv.conf
SCRIPT
  chmod +x "/var/lib/odin-test/udhcpc-$TEL.sh"
  rm -f /run/bail-telephone
  dans busybox udhcpc -i "$itf" -n -q -f -t 10 -T 2 -s "/var/lib/odin-test/udhcpc-$TEL.sh" >/dev/null 2>&1 || { echo "associé, pas de bail DHCP"; return 1; }
  echo "connecté"
}

deconnecter() {
  local itf; itf=$(if_de "$TEL")
  pkill -x dhcpcd 2>/dev/null
  [ -f "/run/wpa-$TEL.pid" ] && kill "$(cat "/run/wpa-$TEL.pid")" 2>/dev/null
  rm -f "/run/wpa-$TEL.pid" "/run/wpa-$TEL.conf"
  dans ip -4 addr flush dev "$itf" 2>/dev/null
  echo "déconnecté"
}

verifier() {
  local itf adresse nom
  itf=$(if_de "$TEL"); nom=$(hostname)
  adresse=$(sed -n 's/^  "adresse": "\(.*\)",/\1/p' "$ETAT")
  echo "1. Installation"
  grep -q '"etat": "actif"' "$ETAT" && ok "point-acces.json : actif" || ko "point-acces.json : $(tr -d '\n' < "$ETAT" 2>/dev/null)"
  for f in point-acces-wifi.svg point-acces-adresse.svg; do
    grep -q '<svg' "/opt/odin/data/config/$f" 2>/dev/null && ok "$f" || ko "$f absent"
  done
  echo "2. Connexion"
  [ "$(connecter 'mauvais-mot-2-passe')" = non-associé ] && ok "refus avec un mauvais mot de passe" || ko "mauvais mot de passe accepté"
  sleep 3
  # A second try: just after a radio moved to the namespace, the first association may time out
  local r; r=$(connecter); [ "$r" = connecté ] || { sleep 3; r=$(connecter); }
  [ "$r" = connecté ] && ok "connexion avec le bon mot de passe" || { ko "connexion : $r"; return; }
  echo "3. Bail et DNS"
  local ip routeur dns
  ip=$(sed -n 's/^ip=//p' /run/bail-telephone); routeur=$(sed -n 's/^router=//p' /run/bail-telephone)
  dns=$(sed -n 's/^dns=//p' /run/bail-telephone)
  local d=${ip##*.}
  [ "${ip%.*}" = "${adresse%.*}" ] && [ "$d" -ge 10 ] && [ "$d" -le 250 ] && ok "bail $ip dans la plage" || ko "bail $ip"
  [ "$routeur" = "$adresse" ] && ok "passerelle $routeur" || ko "passerelle $routeur"
  [ "$dns" = "$adresse" ] && ok "DNS $dns" || ko "DNS $dns"
  for n in "$nom" "$nom.lan" exemple-quelconque.org connectivitycheck.gstatic.com; do
    r=$(dans busybox nslookup "$n" "$adresse" 2>/dev/null | awk '/^Address/ && !/#53/ { print $NF }' | tail -1)
    [ "$r" = "$adresse" ] && ok "$n → $r" || ko "$n → ${r:-rien}"
  done
  echo "4. Page d'ODIN"
  r=$(dans curl -s -m 10 -o /dev/null -w '%{http_code} %{redirect_url}' "http://$nom.lan/")
  [[ "$r" == "302 "*"/connexion"* ]] && ok "http://$nom.lan/ → $r" || ko "http://$nom.lan/ → $r"
  r=$(dans curl -s -m 10 "http://$nom.lan/connexion" | grep -o 'Première utilisation\|Connexion requise' | head -1)
  [ -n "$r" ] && ok "page de connexion : « $r »" || ko "page de connexion absente"
  echo "5. Aucune sortie"
  curl -s -m 8 -o /dev/null https://1.1.1.1 && ok "la VM joint 1.1.1.1 (TCP 443)" || ko "la VM n'a pas internet : test sans valeur"
  dans timeout 6 bash -c '</dev/tcp/1.1.1.1/443' 2>/dev/null && ko "téléphone → 1.1.1.1:443 JOIGNABLE" || ok "téléphone → 1.1.1.1:443 injoignable"
  dans ping -c 2 -W 2 1.1.1.1 >/dev/null 2>&1 && ko "téléphone → ping 1.1.1.1 JOIGNABLE" || ok "téléphone → ping 1.1.1.1 injoignable"
  local passerelle; passerelle=$(ip route show default | awk '{ print $3; exit }')
  dans timeout 6 bash -c "</dev/tcp/$passerelle/80" 2>/dev/null && ko "téléphone → box $passerelle:80 JOIGNABLE" || ok "téléphone → box $passerelle:80 injoignable"
  echo "  Règles : $(iptables -w -S DOCKER-USER | grep -c 'ctstate DNAT') IPv4, $(ip6tables -w -S DOCKER-USER 2>/dev/null | grep -c 'ctstate DNAT') IPv6 ; paquets refusés : $(iptables -w -L DOCKER-USER -v -n -x | awk '/DROP/ { print $1 }')"
  echo
  [ "$ECHECS" -eq 0 ] && echo "Tout est bon." || echo "$ECHECS échec(s)."
}

# B6: every probe before release (302 to the portal), release, then the exact answer, byte for byte.
# Expected values typed from the sources (CLAUDE.md), independent of dashboard/lib/portail.mjs.
APPLE='<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>'
SONDES=(
  "connectivitycheck.gstatic.com|/generate_204|204|"
  "www.google.com|/gen_204|204|"
  "clients3.google.com|/generate_204|204|"
  "play.googleapis.com|/generate_204|204|"
  "captive.apple.com|/hotspot-detect.html|200|$APPLE\n"
  "www.apple.com|/library/test/success.html|200|$APPLE"
  "www.msftconnecttest.com|/connecttest.txt|200|Microsoft Connect Test"
  "www.msftncsi.com|/ncsi.txt|200|Microsoft NCSI"
  "firefox-portal-detection.com|/generate_204|204|"
  "firefox-portal-detection.com|/success.txt?ipv4|200|success\n"
  "detectportal.firefox.com|/success.txt|200|success\n"
  "detectportal.firefox.com|/canonical.html|200|<meta http-equiv=\"refresh\" content=\"0;url=https://support.mozilla.org/kb/captive-portal\"/>"
  "connectivity-check.ubuntu.com.|/|204|"
  "nmcheck.gnome.org|/check_network_status.txt|200|NetworkManager is online"
)

portail() {
  local adresse s hote chemin statut corps r
  adresse=$(sed -n 's/^  "adresse": "\(.*\)",/\1/p' "$ETAT")
  # Released devices live in the dashboard's memory only (12 h): restarting it makes the phone a new,
  # not released device, so the test can be run again at once
  docker restart dashboard >/dev/null || { ko "redémarrage du dashboard"; return; }
  local i pret=
  for i in $(seq 60); do
    [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://$adresse/portail")" = 200 ] && { pret=1; break; }
    sleep 1
  done
  [ -n "$pret" ] || { ko "dashboard pas prêt après 60 s"; return; }
  # Same second try as verifier: a reconnection right after another one may time out
  [ "$(connecter)" = connecté ] || { sleep 3; [ "$(connecter)" = connecté ]; } || { ko "téléphone non connecté"; return; }
  echo "6. Portail captif"
  echo "  avant « Continuer »"
  for s in "${SONDES[@]}"; do
    IFS='|' read -r hote chemin statut corps <<<"$s"
    r=$(dans curl -s -m 8 -o /dev/null -w '%{http_code} %{redirect_url}' "http://$hote$chemin")
    [ "$r" = "302 http://$adresse/portail" ] && ok "$hote$chemin → $r" || ko "$hote$chemin → $r"
  done
  r=$(dans curl -s -m 8 -o /dev/null -w '%{http_code}' "http://$adresse/portail")
  [ "$r" = 200 ] && ok "page /portail : 200" || ko "page /portail : $r"
  r=$(dans curl -s -m 8 -o /dev/null -w '%{http_code} %{redirect_url}' -X POST "http://$adresse/api/portail/liberer")
  [ "$r" = "303 http://$adresse/portail?libre=1" ] && ok "Continuer → $r" || ko "Continuer → $r"
  echo "  après « Continuer »"
  local attendu obtenu entete
  for s in "${SONDES[@]}"; do
    IFS='|' read -r hote chemin statut corps <<<"$s"
    attendu=$(mktemp); obtenu=$(mktemp); entete=$(mktemp)
    printf '%b' "$corps" > "$attendu"
    r=$(dans curl -s -m 8 -D "$entete" -o "$obtenu" -w '%{http_code}' "http://$hote$chemin")
    if [ "$r" = "$statut" ] && cmp -s "$attendu" "$obtenu" && grep -qi '^X-NetworkManager-Status: online' "$entete"; then
      ok "$hote$chemin → $r, $(stat -c %s "$obtenu") octets identiques"
    else
      ko "$hote$chemin → $r, $(stat -c %s "$obtenu") octets (attendu $statut, $(stat -c %s "$attendu") octets)"
    fi
    rm -f "$attendu" "$obtenu" "$entete"
  done
  r=$(dans curl -s -m 8 -o /dev/null -w '%{http_code} %{redirect_url}' "http://exemple-quelconque.org/page")
  [ "$r" = "302 http://$adresse/" ] && ok "autre domaine → $r" || ko "autre domaine → $r"
  r=$(dans busybox nslookup -type=a dns.msftncsi.com "$adresse" 2>/dev/null | awk '/^Address/ && !/#53/ { print $NF }' | tail -1)
  [ "$r" = 131.107.255.255 ] && ok "dns.msftncsi.com → $r" || ko "dns.msftncsi.com → $r"
  r=$(dans curl -s -m 8 -o /dev/null -w '%{http_code} %{redirect_url}' "http://$adresse/")
  [[ "$r" == "302 "*"/connexion"* ]] && ok "ODIN par son adresse → $r (pas de portail)" || ko "ODIN par son adresse → $r"
  echo
  [ "$ECHECS" -eq 0 ] && echo "Tout est bon." || echo "$ECHECS échec(s)."
}

nettoyer() {
  deconnecter >/dev/null 2>&1
  ip netns del "$TEL" 2>/dev/null; ip netns del "$BOX" 2>/dev/null
  rm -rf "/etc/netns/$TEL" /var/lib/odin-test /etc/modules-load.d/odin-test-hwsim.conf /etc/modprobe.d/odin-test-hwsim.conf
  echo "Nettoyé (hwsim reste chargé jusqu'au prochain redémarrage)."
}

case "${1:-}" in
  preparer) preparer ;;
  connecter) connecter "${2:-}" ;;
  deconnecter) deconnecter ;;
  verifier) verifier; [ "$ECHECS" -eq 0 ] ;;
  portail) portail; [ "$ECHECS" -eq 0 ] ;;
  nettoyer) nettoyer ;;
  *) echo "Usage : sudo $0 preparer|connecter [mdp]|verifier|deconnecter|nettoyer"; exit 1 ;;
esac

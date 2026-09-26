#!/usr/bin/env bash
# Tests B of the access point with virtual radios (mac80211_hwsim), on a TEST VM only (never on the
# test server odintest: this touches the network and the firewall). docs/conception-point-acces.md.
#
#   sudo scripts/point-acces-test.sh preparer        hwsim (3 radios, also at boot), phone and box namespaces
#   sudo scripts/point-acces-test.sh connecter [mdp] the phone joins the network (password of ODIN by default)
#   sudo scripts/point-acces-test.sh verifier        points 1 to 5 of the brief, one line each
#   sudo scripts/point-acces-test.sh portail         point 6: captive portal, every probe before and after release
#   sudo scripts/point-acces-test.sh deconnecter
#   sudo scripts/point-acces-test.sh box demarrer|arreter      fake box (Wi-Fi BOX-TEST + DHCP) on the 3rd radio
#   sudo scripts/point-acces-test.sh client networkd|nm|retirer ODIN's card joins the box (netplan or NetworkManager)
#   sudo scripts/point-acces-test.sh demande activer|desactiver as the dashboard does; waits for the result
#   sudo scripts/point-acces-test.sh hostapd casser|reparer    hostapd of ODIN fails at every start (drop-in)
#   sudo scripts/point-acces-test.sh bilan               state, route of the card, managers, one line each
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

# --- Switch of a card that carries the connection (fake box on wlan2, in the « box » namespace) ---

BOX_SSID=BOX-TEST
BOX_MDP=box-test-1234
BOX_IP=192.168.77.1
ODIN_IF=wlan0
NETPLAN_TEST=/etc/netplan/60-odin-test-wifi.yaml
CASSE=/etc/systemd/system/odin-hostapd.service.d/odin-test-casse.conf

box() {
  local itf; itf=$(if_de "$BOX")
  case "$1" in
    demarrer)
      box arreter >/dev/null 2>&1
      ip netns exec "$BOX" ip link set "$itf" up
      ip netns exec "$BOX" ip addr replace "$BOX_IP/24" dev "$itf"
      printf 'interface=%s\ndriver=nl80211\nssid=%s\nhw_mode=g\nchannel=1\nwpa=2\nwpa_key_mgmt=WPA-PSK\nrsn_pairwise=CCMP\nwpa_passphrase=%s\n' "$itf" "$BOX_SSID" "$BOX_MDP" > /run/odin-test-box-hostapd.conf
      ip netns exec "$BOX" /usr/sbin/hostapd -B -P /run/odin-test-box-hostapd.pid /run/odin-test-box-hostapd.conf >/dev/null
      ip netns exec "$BOX" /usr/sbin/dnsmasq --conf-file=/dev/null --interface="$itf" --bind-interfaces --except-interface=lo \
        --dhcp-range=192.168.77.10,192.168.77.50,255.255.255.0,1h --dhcp-option=option:router,$BOX_IP \
        --dhcp-leasefile=/run/odin-test-box.leases --pid-file=/run/odin-test-box-dnsmasq.pid --port=0
      echo "Box $BOX_SSID sur $itf ($BOX_IP)" ;;
    arreter)
      local f; for f in /run/odin-test-box-hostapd.pid /run/odin-test-box-dnsmasq.pid; do
        [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"
      done
      echo "Box arrêtée" ;;
  esac
}

# ODIN's card becomes a client of the box, with a higher metric than the Ethernet (the VM keeps its
# own access): the card « carries a default route », which is what the access point must handle
client() {
  local i
  case "$1" in
    networkd)
      client retirer >/dev/null 2>&1
      cat > "$NETPLAN_TEST" <<YAML
network:
  version: 2
  wifis:
    $ODIN_IF:
      dhcp4: true
      dhcp4-overrides: { route-metric: 600 }
      access-points:
        "$BOX_SSID": { password: "$BOX_MDP" }
YAML
      chmod 600 "$NETPLAN_TEST"
      # Not « netplan apply »: it renews the Ethernet lease too, which cuts multipass exec
      netplan generate && systemctl daemon-reload && networkctl reload \
        && systemctl restart "netplan-wpa-$ODIN_IF.service" && networkctl reconfigure "$ODIN_IF" ;;
    nm)
      client retirer >/dev/null 2>&1
      nmcli device set "$ODIN_IF" managed yes 2>/dev/null
      nmcli device wifi rescan ifname "$ODIN_IF" >/dev/null 2>&1; sleep 3
      nmcli -w 30 device wifi connect "$BOX_SSID" password "$BOX_MDP" ifname "$ODIN_IF" name odin-test-box >/dev/null
      nmcli connection modify odin-test-box ipv4.route-metric 600 >/dev/null && nmcli -w 30 connection up odin-test-box >/dev/null ;;
    retirer)
      systemctl stop "netplan-wpa-$ODIN_IF.service" 2>/dev/null
      rm -f "$NETPLAN_TEST"; netplan generate && systemctl daemon-reload && networkctl reload
      ip -4 addr flush dev "$ODIN_IF"
      command -v nmcli >/dev/null && nmcli connection delete odin-test-box >/dev/null 2>&1
      echo "Client retiré"; return ;;
  esac
  for i in $(seq 40); do ip route show default dev "$ODIN_IF" | grep -q . && break; sleep 1; done
  ip route show default dev "$ODIN_IF" | grep -q . && echo "Carte $ODIN_IF cliente de la box : $(ip -4 -o addr show dev "$ODIN_IF" | awk '{ print $4 }')" || { echo "Carte $ODIN_IF : pas de route par défaut"; return 1; }
}

# Same file as the dashboard writes; waits for the host to finish (its unit), then prints the state
demande() {
  local data f i
  data=$(sed -n "s/^DATA=//p" "$ETC/parametres" | tr -d "'\"")
  f="$data/config/point-acces-demande"
  printf '%s\n' "$1" > "$f.tmp" && mv -f "$f.tmp" "$f"
  local debut=$SECONDS
  for i in $(seq 150); do
    sleep 1
    # « activating » while a oneshot runs: only inactive or failed means done
    [ ! -e "$f" ] && [[ "$(systemctl show -p ActiveState --value odin-point-acces-demande.service)" =~ ^(inactive|failed)$ ]] && break
  done
  echo "Demande « $1 » traitée en $((SECONDS - debut)) s"
  bilan
}

# The daemon-reload of the test makes netplan rewrite its files: networkd takes them at once (the
# Ethernet lease is renewed here, during the test setup), so that ODIN's switches are measured clean
recharger() { systemctl daemon-reload; networkctl reload 2>/dev/null; sleep 3; }

hostapd() {
  case "$1" in
    casser) mkdir -p "$(dirname "$CASSE")"; printf '[Service]\nExecStart=\nExecStart=/bin/false\n' > "$CASSE"; recharger; echo "hostapd d'ODIN cassé" ;;
    reparer) rm -f "$CASSE"; rmdir "$(dirname "$CASSE")" 2>/dev/null; recharger; echo "hostapd d'ODIN réparé" ;;
  esac
}

bilan() {
  local j; j=$(cat "$ETAT" 2>/dev/null)
  echo "  état        $(sed -n 's/^  "etat": "\(.*\)",/\1/p' <<<"$j") (actif $(sed -n 's/^  "actif": \(.*\),/\1/p' <<<"$j"))"
  echo "  action      $(tr -d '\n' <<<"$j" | sed -n 's/.*"derniereAction": \({[^}]*}\|null\).*/\1/p')"
  echo "  erreur      $(tr -d '\n' <<<"$j" | sed -n 's/.*"derniereErreur": \({[^}]*}\|null\).*/\1/p')"
  echo "  route       $(ip route show default dev "$ODIN_IF" 2>/dev/null | head -1)"
  echo "  mode        $(iw dev "$ODIN_IF" info 2>/dev/null | awk '$1 == "type" { print $2 }')  adresses $(ip -4 -o addr show dev "$ODIN_IF" | awk '{ printf "%s ", $4 }')"
  echo "  unités      hostapd $(systemctl is-active odin-hostapd.service) · dnsmasq $(systemctl is-active odin-dnsmasq.service) · cible $(systemctl is-enabled odin-point-acces.target 2>/dev/null)"
  echo "  netplan-wpa $(systemctl is-enabled "netplan-wpa-$ODIN_IF.service" 2>/dev/null) / $(systemctl is-active "netplan-wpa-$ODIN_IF.service" 2>/dev/null)"
  command -v nmcli >/dev/null && echo "  NM          $(nmcli -t -f DEVICE,STATE,CONNECTION device status 2>/dev/null | grep "^$ODIN_IF:")"
  echo "  fichiers    voulu=$(cat "$ETC/voulu" 2>/dev/null || echo -) origine=$( [ -f "$ETC/origine" ] && tr '\n' ' ' < "$ETC/origine" || echo -)"
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
  box) box "${2:-}" ;;
  client) client "${2:-}" ;;
  demande) demande "${2:-}" ;;
  hostapd) hostapd "${2:-}" ;;
  bilan) bilan ;;
  nettoyer) box arreter >/dev/null 2>&1; client retirer >/dev/null 2>&1; hostapd reparer >/dev/null; nettoyer ;;
  *) echo "Usage : sudo $0 preparer|connecter [mdp]|verifier|portail|box|client|demande|hostapd|bilan|deconnecter|nettoyer"; exit 1 ;;
esac

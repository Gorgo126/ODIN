#!/usr/bin/env bash
# Simule un réseau local sans internet (test uniquement, jamais sur un serveur en service).
# couper : bloque et journalise tout trafic vers internet, DNS compris, même après redémarrage.
set -euo pipefail

REGLES=/etc/odin-hors-ligne.nft
SERVICE=odin-hors-ligne
TABLE="inet odin_hl"

[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }

case "${1:-}" in
  couper)
    cat > "$REGLES" <<'EOF'
table inet odin_hl {
  set locaux4 { type ipv4_addr; flags interval; elements = { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16, 224.0.0.0/4 } }
  chain filtre {
    meta l4proto { tcp, udp } th dport 53 ip daddr != 127.0.0.0/8 log prefix "ODIN-HL dns " drop
    meta l4proto { tcp, udp } th dport 53 ip6 daddr != ::1 log prefix "ODIN-HL dns " drop
    ip daddr != @locaux4 log prefix "ODIN-HL " drop
    ip6 daddr != { ::1, fe80::/10, ff00::/8 } log prefix "ODIN-HL6 " drop
  }
  chain sortie { type filter hook output priority -10; jump filtre; }
  chain transit { type filter hook forward priority -10; jump filtre; }
}
EOF
    # Loaded before Docker, without flushing Docker's own rules
    cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=ODIN : simulation hors ligne
Before=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=-/usr/sbin/nft delete table $TABLE
ExecStart=/usr/sbin/nft -f $REGLES
ExecStop=-/usr/sbin/nft delete table $TABLE
[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now "$SERVICE" >/dev/null 2>&1
    systemctl restart "$SERVICE"
    if curl -s -m 5 -o /dev/null https://github.com; then echo "Échec : internet est encore joignable."; exit 1; fi
    echo "Internet coupé (le réseau local reste joignable)."
    ;;
  retablir)
    systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
    nft delete table $TABLE 2>/dev/null || true
    rm -f "$REGLES" "/etc/systemd/system/$SERVICE.service"
    systemctl daemon-reload
    echo "Internet rétabli."
    ;;
  journal)
    # One line per blocked source/destination, container IPs replaced by their names
    noms=$(docker ps -q | xargs -r docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}} {{.Name}}' \
      | awk '$1 != "" { gsub("/", "", $2); printf "s/ %s / %s /;", $1, $2 }')
    journalctl -k -b --no-pager | grep -o 'ODIN-HL.*' \
      | sed -E 's/.*(ODIN-HL[0-9]*( dns)?) .*SRC=([^ ]+) DST=([^ ]+).*DPT=([0-9]+).*/\1 \3 -> \4:\5/' \
      | sed -E "s/ -> / -> /;${noms}" \
      | sort | uniq -c | sort -rn
    ;;
  *)
    echo "Usage : sudo $0 couper|retablir|journal"
    exit 1
    ;;
esac

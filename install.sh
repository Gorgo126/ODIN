#!/usr/bin/env bash
set -euo pipefail

DEPOT="${DEPOT:-https://github.com/Gorgo126/ODIN.git}"
CIBLE="/opt/odin"
NOM_HOTE="${NOM_HOTE:-odin}"

msg() { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }
err() { printf '\n\033[1;31mErreur:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || err "Lancez ce script avec sudo."

. /etc/os-release 2>/dev/null || err "Système non reconnu."
case "$ID" in
  ubuntu|debian) ;;
  *) err "Ubuntu ou Debian requis (détecté : $ID)." ;;
esac

UTILISATEUR="${SUDO_USER:-root}"

msg "Dépendances"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git avahi-daemon

if ! command -v docker >/dev/null 2>&1; then
  msg "Installation de Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  [ "$UTILISATEUR" != "root" ] && usermod -aG docker "$UTILISATEUR"
else
  msg "Docker déjà présent"
fi

msg "Récupération des sources"
if [ -d "$CIBLE/.git" ]; then
  git -C "$CIBLE" pull --ff-only
else
  mkdir -p "$CIBLE"
  [ -f "$CIBLE/data/zim/library.xml" ] || printf '<?xml version="1.0" encoding="UTF-8"?>\n<library version="20110515">\n</library>\n' > "$CIBLE/data/zim/library.xml"
  git clone --depth 1 "$DEPOT" "$CIBLE"
fi

[ -f "$CIBLE/.env" ] || cp "$CIBLE/.env.exemple" "$CIBLE/.env"
mkdir -p "$CIBLE/data/zim" "$CIBLE/data/ollama" "$CIBLE/data/openwebui"
[ "$UTILISATEUR" != "root" ] && chown -R "$UTILISATEUR:$UTILISATEUR" "$CIBLE"

msg "Nom réseau"
if [ "$(hostname)" != "$NOM_HOTE" ]; then
  hostnamectl set-hostname "$NOM_HOTE"
  grep -q "127.0.1.1" /etc/hosts \
    && sed -i "s/^127.0.1.1.*/127.0.1.1\t$NOM_HOTE/" /etc/hosts \
    || echo -e "127.0.1.1\t$NOM_HOTE" >> /etc/hosts
fi
systemctl enable avahi-daemon >/dev/null 2>&1 || true
systemctl restart avahi-daemon >/dev/null 2>&1 || true

msg "Démarrage des services"
cd "$CIBLE"
docker compose up -d --build

msg "Terminé"
echo
echo "  Accès :  http://$NOM_HOTE.local"
for ip in $(hostname -I); do echo "           http://$ip"; done
echo
echo "  Ajouter du contenu : déposez vos .zim dans $CIBLE/data/zim"
echo "  puis lancez        : $CIBLE/scripts/maj-bibliotheque.sh"
echo

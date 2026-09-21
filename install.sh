#!/usr/bin/env bash
set -euo pipefail

DEPOT="${DEPOT:-https://github.com/Gorgo126/ODIN.git}"
BRANCHE="${BRANCHE:-main}"
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
  # Explicit refspec: a --depth 1 clone only tracks its original branch
  git -C "$CIBLE" fetch origin "+refs/heads/$BRANCHE:refs/remotes/origin/$BRANCHE" \
    || err "Branche $BRANCHE introuvable sur $DEPOT."
  git -C "$CIBLE" checkout "$BRANCHE" 2>/dev/null \
    || git -C "$CIBLE" checkout -b "$BRANCHE" --track "origin/$BRANCHE"
  git -C "$CIBLE" merge --ff-only "origin/$BRANCHE"
else
  mkdir -p "$CIBLE"
  git clone --depth 1 -b "$BRANCHE" "$DEPOT" "$CIBLE" \
    || err "Clonage de la branche $BRANCHE impossible depuis $DEPOT."
fi

[ -f "$CIBLE/.env" ] || cp "$CIBLE/.env.exemple" "$CIBLE/.env"
mkdir -p "$CIBLE/data/zim" "$CIBLE/data/ollama" "$CIBLE/data/openwebui" "$CIBLE/data/config" "$CIBLE/data/documents" "$CIBLE/data/filebrowser" "$CIBLE/data/synchro" "$CIBLE/data/cartes"
[ -f "$CIBLE/data/zim/library.xml" ] || printf '<?xml version="1.0" encoding="UTF-8"?>\n<library version="20110515">\n</library>\n' > "$CIBLE/data/zim/library.xml"
[ "$UTILISATEUR" != "root" ] && chown -R "$UTILISATEUR:$UTILISATEUR" "$CIBLE"

msg "Nom réseau"
if [ "$(hostname)" != "$NOM_HOTE" ]; then
  hostnamectl set-hostname "$NOM_HOTE"
  grep -q "127.0.1.1" /etc/hosts \
    && sed -i "s/^127.0.1.1.*/127.0.1.1\t$NOM_HOTE/" /etc/hosts \
    || echo -e "127.0.1.1\t$NOM_HOTE" >> /etc/hosts
fi
if ! grep -q "^deny-interfaces=" /etc/avahi/avahi-daemon.conf; then
  sed -i '/^\[server\]/a deny-interfaces=docker0,br-' /etc/avahi/avahi-daemon.conf
fi
if ! grep -q "^deny-interfaces=" /etc/avahi/avahi-daemon.conf; then
  sed -i '/^\[server\]/a deny-interfaces=docker0' /etc/avahi/avahi-daemon.conf
fi
systemctl enable avahi-daemon >/dev/null 2>&1 || true
systemctl restart avahi-daemon >/dev/null 2>&1 || true

msg "Démarrage des services"
cd "$CIBLE"
docker compose pull
docker compose up -d

msg "Modèles d'IA (plusieurs Go, cela peut prendre un moment)"
docker exec ollama ollama pull "${MODELE_CHAT:-qwen2.5:3b}"
docker exec ollama ollama pull bge-m3

msg "Fond de carte mondial"
# Installed through the dashboard, which holds the pinned pmtiles tool
docker exec dashboard node -e '
const api = (m, c) => fetch("http://localhost:3000/api/cartes" + c, { method: m }).then((r) => r.json());
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let fond;
  for (let i = 0; i < 30 && !fond; i++) {
    fond = await api("GET", "").then((l) => l.packs.find((p) => p.id === "fond")).catch(() => pause(2000));
  }
  if (!fond) throw new Error("tableau de bord injoignable");
  if (fond.installe) return console.log("  Déjà installé.");
  const t = await api("POST", "/fond");
  if (t.erreur) throw new Error(t.erreur);
  for (let i = 0; i < 450; i++) {
    await pause(2000);
    const p = (await api("GET", "")).packs.find((p) => p.id === "fond");
    if (p.installe) return console.log("  Installé.");
    if (p.tache?.etat === "erreur") throw new Error(p.tache.erreur);
  }
  throw new Error("délai dépassé");
})().catch((e) => { console.error("  " + e.message); process.exit(1); });
' || echo "  Fond de carte non installé : ajoutez-le depuis Configuration, section Cartes."

msg "Terminé"
echo
echo "  Ouvrez ODIN depuis n'importe quel appareil du réseau :"
ip -4 -o addr show scope global \
  | awk '$2 !~ /^(docker|br-|veth)/ { split($4, a, "/"); print "    http://" a[1] }'
echo
echo "  À la première visite, choisissez le mot de passe qui protégera ODIN."
echo "  Le contenu (Wikipédia, livres, médecine...) s'installe depuis le tableau de bord."
echo

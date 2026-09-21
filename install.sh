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
# The script runs as root on a folder owned by the user: git refuses it unless allowed explicitly
depot() { git -c safe.directory="$CIBLE" -C "$CIBLE" "$@"; }
AVANT=""
if [ -d "$CIBLE/.git" ]; then
  AVANT=$(depot rev-parse HEAD)
  # Explicit refspec: a --depth 1 clone only tracks its original branch
  depot fetch origin "+refs/heads/$BRANCHE:refs/remotes/origin/$BRANCHE" \
    || err "Branche $BRANCHE introuvable sur $DEPOT."
  depot checkout "$BRANCHE" 2>/dev/null \
    || depot checkout -b "$BRANCHE" --track "origin/$BRANCHE"
  depot merge --ff-only "origin/$BRANCHE" \
    || err "Mise à jour impossible : des fichiers d'ODIN ont été modifiés sur ce serveur (voir git -C $CIBLE status). Les réglages personnels vont dans .env."
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

# A service reading a file of the repository keeps the old version after an update: git replaces
# the file, a single-file mount stays on the old one, and synchro keeps its code in memory.
# up -d only recreates services whose compose.yml definition changed, so restart the others.
if [ -n "$AVANT" ]; then
  a_relancer=()
  for couple in "caddy:Caddyfile" "filebrowser:config/filebrowser.yaml" "synchro:synchro"; do
    depot diff --quiet "$AVANT" HEAD -- "${couple#*:}" || a_relancer+=("${couple%%:*}")
  done
  if [ ${#a_relancer[@]} -gt 0 ]; then
    echo "  Configuration modifiée, redémarrage : ${a_relancer[*]}"
    docker compose restart "${a_relancer[@]}"
  fi
fi

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
  if (!fond.installe) {
    const t = await api("POST", "/fond");
    if (t.erreur) throw new Error(t.erreur);
    for (let i = 0; i < 450 && !fond.installe; i++) {
      await pause(2000);
      fond = (await api("GET", "")).packs.find((p) => p.id === "fond");
      if (fond.tache?.etat === "erreur") throw new Error(fond.tache.erreur);
    }
    if (!fond.installe) throw new Error("délai dépassé");
  }
  console.log("  Installé. Mesure de la taille des autres packs, pour l\u0027affichage hors ligne.");
  for (const p of (await api("GET", "")).packs) await api("GET", "/" + p.id).catch(() => {});
})().catch((e) => { console.error("  " + e.message); process.exit(1); });
' || echo "  Fond de carte non installé : ajoutez-le depuis Configuration, section Cartes."

msg "Taille des contenus de la bibliothèque"
# Reading the Kiwix catalogue records each pack size, shown offline later
docker exec dashboard node -e '
fetch("http://localhost:3000/api/packs", { signal: AbortSignal.timeout(120000) })
  .then((r) => r.json())
  .then((l) => {
    const n = l.filter((p) => p.taille).length;
    console.log(`  ${n} tailles sur ${l.length} relevées.`);
    if (!n) process.exit(1);
  })
  .catch(() => process.exit(1));
' || echo "  Tailles non relevées : elles le seront à la prochaine visite de Configuration avec internet."

msg "Terminé"
echo
echo "  Ouvrez ODIN depuis n'importe quel appareil du réseau :"
ip -4 -o addr show scope global \
  | awk '$2 !~ /^(docker|br-|veth)/ { split($4, a, "/"); print "    http://" a[1] }'
echo
echo "  À la première visite, choisissez le mot de passe qui protégera ODIN."
echo "  Le contenu (Wikipédia, livres, médecine...) s'installe depuis le tableau de bord."
echo

#!/usr/bin/env bash
set -euo pipefail

DEPOT="${DEPOT:-https://github.com/Gorgo126/ODIN.git}"
BRANCHE="${BRANCHE:-main}"
CIBLE="/opt/odin"
# Default name "odin" on a new install; an update keeps the current name unless NOM_HOTE is given
if [ -z "${NOM_HOTE:-}" ]; then
  if [ -d "$CIBLE/.git" ]; then NOM_HOTE=$(hostname); else NOM_HOTE=odin; fi
fi

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
mkdir -p "$CIBLE/data/zim" "$CIBLE/data/vecteurs" "$CIBLE/data/config" "$CIBLE/data/documents" "$CIBLE/data/filebrowser" "$CIBLE/data/cartes" "$CIBLE/data/assistant"
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

msg "Modèle de la recherche avancée"
# EmbeddingGemma for llama.cpp (service « vecteurs »). Downloaded now and checked: offline, the
# search never fetches anything. Pinned revision and SHA-256; a file that fails the check is dropped.
VECTEURS_FICHIER=embeddinggemma-300M-Q8_0.gguf
VECTEURS_SOURCE="https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/0f741b5a6585bd53aeb15cd1372c56f2a0f65e12/$VECTEURS_FICHIER"
VECTEURS_SHA256=b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63
modele_vecteurs() {
  local f="$CIBLE/data/vecteurs/$VECTEURS_FICHIER"
  if [ -f "$f" ]; then echo "  Déjà présent."; return 0; fi
  # No total delay (334 MB), but a stalled transfer stops after 60 s; resumed on the next run
  curl -fL --progress-bar --connect-timeout 15 --speed-limit 1024 --speed-time 60 -C - -o "$f.part" "$VECTEURS_SOURCE" || return 1
  if ! echo "$VECTEURS_SHA256  $f.part" | sha256sum -c --quiet - >/dev/null 2>&1; then
    rm -f "$f.part"
    echo "  Empreinte incorrecte : fichier supprimé."
    return 1
  fi
  mv "$f.part" "$f"
  [ "$UTILISATEUR" != "root" ] && chown "$UTILISATEUR:$UTILISATEUR" "$f"
  echo "  Téléchargé et vérifié."
}
modele_vecteurs || echo "  Modèle non installé : la recherche marche par mots-clés seulement. Relancez l'installeur avec internet."

msg "Démarrage des services"
cd "$CIBLE"
docker compose pull
docker compose up -d --remove-orphans

# --- Migration: former assistant (Open WebUI + synchro). To be removed after v1. ---
# Removes its containers, image, models and test data. The documents in data/documents stay untouched.
# Never blocking: any failure only prints a warning, and the next run of the installer tries again.
migrer_ancien_assistant() {
  local retire=0 ctn img m d
  ctn=$(docker ps -aq --filter 'name=^ia$' --filter 'name=^synchro$')
  if [ -n "$ctn" ]; then docker rm -f $ctn >/dev/null; retire=1; fi
  img=$(docker image ls -q ghcr.io/open-webui/open-webui | sort -u)
  if [ -n "$img" ]; then docker image rm -f $img >/dev/null || true; retire=1; fi
  # Only where Ollama still runs (AI option); it may still be starting right after up -d
  local modeles=""
  if [ -n "$(docker ps -q --filter 'name=^ollama$')" ]; then
    for _ in $(seq 30); do modeles=$(docker exec ollama ollama list 2>/dev/null) && break; sleep 1; done
  fi
  if [ -n "$modeles" ]; then
    for m in qwen2.5:3b bge-m3:latest; do
      if awk -v m="$m" 'NR > 1 && $1 == m { t = 1 } END { exit !t }' <<<"$modeles"; then
        docker exec ollama ollama rm "$m" >/dev/null || echo "  Avertissement : modèle $m non retiré."
        retire=1
      fi
    done
  fi
  for d in openwebui synchro; do
    if [ -d "$CIBLE/data/$d" ]; then rm -rf "${CIBLE:?}/data/$d"; retire=1; fi
  done
  if [ "$retire" -eq 1 ]; then echo "  Ancien assistant (Open WebUI) retiré : conteneurs, image, modèles et données de test."; fi
}
migrer_ancien_assistant || echo "  Avertissement : nettoyage de l'ancien assistant incomplet, l'installation continue."
# --- End of migration ---

# A service reading a file of the repository keeps the old version after an update: git replaces
# the file and a single-file mount stays on the old one.
# up -d only recreates services whose compose.yml definition changed, so restart the others.
if [ -n "$AVANT" ]; then
  a_relancer=()
  for couple in "caddy:Caddyfile" "filebrowser:config/filebrowser.yaml"; do
    depot diff --quiet "$AVANT" HEAD -- "${couple#*:}" || a_relancer+=("${couple%%:*}")
  done
  if [ ${#a_relancer[@]} -gt 0 ]; then
    echo "  Configuration modifiée, redémarrage : ${a_relancer[*]}"
    docker compose restart "${a_relancer[@]}"
  fi
fi

# --- Migration: Ollama leaves the default install (advanced search, lot 4). To be removed after v1. ---
# Without the AI option, up --remove-orphans has already removed its container: its image (9 GB)
# goes too. data/ollama is left in place (models the AI option may reuse); only a note is printed.
if ! grep -q '^COMPOSE_FILE=.*compose\.ia\.yml' .env; then
  img=$(docker image ls -q ollama/ollama | sort -u)
  if [ -n "$img" ] && [ -z "$(docker ps -aq --filter 'name=^ollama$')" ]; then
    docker image rm -f $img >/dev/null 2>&1 && echo "  Ollama retiré : l'IA devient une option, la recherche n'en a plus besoin."
  fi
  if [ -d data/ollama ] && [ -n "$(ls -A data/ollama 2>/dev/null)" ]; then
    echo "  data/ollama ($(du -sh data/ollama | cut -f1)) ne sert plus sans l'option IA : il peut être supprimé."
  fi
fi
# --- End of migration ---

msg "Index des documents"
# The vector service loads its model in a few seconds; the index starts now instead of at the next scan
for _ in $(seq 30); do docker exec caddy wget -qO- http://vecteurs:8080/health >/dev/null 2>&1 && break; sleep 1; done
docker exec dashboard node -e 'fetch("http://localhost:3000/api/assistant/index", { method: "POST", signal: AbortSignal.timeout(30000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))' \
  && echo "  Indexation lancée." \
  || echo "  Indexation des documents : elle démarrera d'elle-même dans les 5 minutes."

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

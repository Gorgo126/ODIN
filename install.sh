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

msg "Dossier des données"
# Data folder: DATA_DIR of .env, relative to $CIBLE unless absolute. DONNEES=<absolute path> puts the
# data elsewhere, typically on a large data disk mounted by the system (fstab). Existing data is never
# moved nor abandoned silently.
dossier_donnees() {
  local d
  d=$(sed -n 's/^DATA_DIR=//p' "$CIBLE/.env" | tail -1)
  d=${d:-./data}
  case "$d" in /*) echo "${d%/}" ;; *) echo "$CIBLE/${d#./}" ;; esac
}
if [ -n "${DONNEES:-}" ]; then
  case "$DONNEES" in /*) ;; *) err "DONNEES doit être un chemin absolu, par exemple DONNEES=/mnt/donnees/odin." ;; esac
  DONNEES=${DONNEES%/}
  ANCIEN=$(dossier_donnees)
  if [ "$DONNEES" != "$ANCIEN" ] && [ -f "$ANCIEN/config/auth.json" ] && [ ! -f "$DONNEES/config/auth.json" ]; then
    err "Les données d'ODIN sont déjà dans $ANCIEN. Pour les déplacer : cd $CIBLE && sudo docker compose down, puis sudo rsync -a $ANCIEN/ $DONNEES/, puis relancez l'installeur avec DONNEES=$DONNEES."
  fi
  if grep -q '^DATA_DIR=' "$CIBLE/.env"; then
    sed -i "s|^DATA_DIR=.*|DATA_DIR=$DONNEES|" "$CIBLE/.env"
  else
    printf 'DATA_DIR=%s\n' "$DONNEES" >> "$CIBLE/.env"
  fi
fi
DATA=$(dossier_donnees)
mkdir -p "$DATA"/{zim,vecteurs,config,documents,filebrowser,cartes,livres,assistant}
[ -f "$DATA/zim/library.xml" ] || printf '<?xml version="1.0" encoding="UTF-8"?>\n<library version="20110515">\n</library>\n' > "$DATA/zim/library.xml"
[ "$UTILISATEUR" != "root" ] && chown -R "$UTILISATEUR:$UTILISATEUR" "$CIBLE" "$DATA"
MONTAGE=$(df -P "$DATA" | awk 'NR==2 {print $6}')
echo "  $DATA (système de fichiers monté sur $MONTAGE)"
if [ "$MONTAGE" = "/" ] && [ -n "${DONNEES:-}" ]; then
  echo "  Attention : ce dossier est sur la partition système. Si un disque de données devait y être monté, il ne l'est pas."
fi
# A separate data disk: Docker waits for it at boot. Otherwise the containers could start before the
# mount, and Docker would create empty folders on the system disk in its place.
if [ "$MONTAGE" != "/" ]; then
  mkdir -p /etc/systemd/system/docker.service.d
  printf '# ODIN : les données sont sur %s, monté avant le démarrage de Docker\n[Unit]\nRequiresMountsFor=%s\n' "$MONTAGE" "$DATA" \
    > /etc/systemd/system/docker.service.d/odin-donnees.conf
  systemctl daemon-reload
elif [ -f /etc/systemd/system/docker.service.d/odin-donnees.conf ]; then
  rm -f /etc/systemd/system/docker.service.d/odin-donnees.conf
  systemctl daemon-reload
fi

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

msg "Matériel pour l'option IA"
# Graphics cards seen by the system, written to config/materiel.json of the data folder for the « Assistant IA »
# page. The AI option (Ollama) is enabled only when a card can run a language model: 8 GB of video
# memory at least (an 8 GB card shows about 8,188 MB, hence 7,680), and the driver that lets Docker
# use it. NOT VERIFIED on real hardware (no GPU to test on): every step falls back to « no AI ».
# ODIN_SIMULER_VRAM=<MB> simulates an NVIDIA card of that size, Ollama then runs on the CPU (tests).
SEUIL_VRAM=7680
# JSON string, or null when empty
chaine() { if [ -n "$1" ]; then printf '"%s"' "$1"; else printf null; fi; }
detecter_materiel() {
  local cartes="" nv_pilote=false nv_toolkit=false kfd=false option="" raison="" vram_max=0 simule=false
  local d classe vendeur nom vram adresse
  if [ -n "${ODIN_SIMULER_VRAM:-}" ]; then
    simule=true; nv_pilote=true; nv_toolkit=true
    vram_max=$(( ${ODIN_SIMULER_VRAM//[^0-9]/} + 0 ))
    cartes="{\"fabricant\":\"nvidia\",\"nom\":\"Carte simulée\",\"vram_mo\":$vram_max}"
  else
    # NVIDIA with its driver: names and video memory (MiB) from nvidia-smi
    if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
      nv_pilote=true
      while IFS=, read -r nom vram; do
        nom=$(printf '%s' "$nom" | tr -d '"\\' | sed 's/^ *//;s/ *$//'); vram=${vram//[^0-9]/}
        [ -n "$vram" ] && [ "$vram" -gt "$vram_max" ] && vram_max=$vram
        cartes+="${cartes:+,}{\"fabricant\":\"nvidia\",\"nom\":\"$nom\",\"vram_mo\":${vram:-null}}"
      done < <(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null)
      docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q nvidia && nv_toolkit=true
    fi
    # Every display controller of the PCI bus (class 03xx), listed from sysfs; lspci, when present,
    # only gives the names
    for d in /sys/bus/pci/devices/*; do
      classe=$(cat "$d/class" 2>/dev/null) || continue
      [ "${classe:0:4}" = "0x03" ] || continue
      vendeur=$(cat "$d/vendor" 2>/dev/null)
      adresse=${d##*/}
      # « 01:00.0 VGA compatible controller: Name » → « Name » (slot, then class removed)
      nom=$(lspci -s "$adresse" 2>/dev/null | cut -d' ' -f2- | sed 's/^[^:]*: //' | tr -d '"\\')
      case "$vendeur" in
        0x10de) $nv_pilote && continue  # already listed by nvidia-smi
                cartes+="${cartes:+,}{\"fabricant\":\"nvidia\",\"nom\":\"${nom:-Carte NVIDIA}\",\"vram_mo\":null}" ;;
        0x1002) vram=$(cat "$d/mem_info_vram_total" 2>/dev/null); vram=${vram:+$(( vram / 1048576 ))}
                [ -n "$vram" ] && [ "$vram" -gt "$vram_max" ] && vram_max=$vram
                cartes+="${cartes:+,}{\"fabricant\":\"amd\",\"nom\":\"${nom:-Carte AMD}\",\"vram_mo\":${vram:-null}}" ;;
        0x8086) cartes+="${cartes:+,}{\"fabricant\":\"intel\",\"nom\":\"${nom:-Carte Intel}\",\"vram_mo\":null}" ;;
        *)      cartes+="${cartes:+,}{\"fabricant\":\"autre\",\"nom\":\"${nom:-Carte graphique}\",\"vram_mo\":null}" ;;
      esac
    done
    [ -e /dev/kfd ] && kfd=true
  fi
  # Which option, if any: the first card family that can really run the model
  if $simule; then
    if [ "$vram_max" -ge "$SEUIL_VRAM" ]; then option=simulation; else raison="memoire"; fi
  elif $nv_pilote && [ "$vram_max" -ge "$SEUIL_VRAM" ] && grep -q '"nvidia"' <<<"$cartes"; then
    if $nv_toolkit; then option=nvidia; else raison="toolkit"; fi
  elif grep -q '"amd"' <<<"$cartes" && [ "$vram_max" -ge "$SEUIL_VRAM" ]; then
    if $kfd; then option=amd; else raison="rocm"; fi
  elif grep -q '"nvidia"' <<<"$cartes" && ! $nv_pilote; then raison="pilote"
  elif grep -q '"nvidia"\|"amd"' <<<"$cartes"; then raison="memoire"
  else raison="aucune"
  fi
  printf '{"detecte_le":"%s","simule":%s,"cartes":[%s],"nvidia":{"pilote":%s,"toolkit":%s},"amd":{"kfd":%s},"option":%s,"raison":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$simule" "$cartes" "$nv_pilote" "$nv_toolkit" "$kfd" \
    "$(chaine "$option")" "$(chaine "$raison")" > "$DATA/config/materiel.json"
  [ "$UTILISATEUR" != "root" ] && chown "$UTILISATEUR:$UTILISATEUR" "$DATA/config/materiel.json"
  # COMPOSE_FILE in .env: the line written here only (a line set by hand without compose.ia.yml stays)
  sed -i '/^# Option IA, écrit par install.sh/d; /^COMPOSE_FILE=.*compose\.ia\.yml/d' "$CIBLE/.env"
  case "$option" in
    nvidia) fichiers="compose.yml:compose.ia.yml:compose.nvidia.yml" ;;
    amd) fichiers="compose.yml:compose.ia.yml:compose.amd.yml" ;;
    simulation) fichiers="compose.yml:compose.ia.yml" ;;
    *) fichiers="" ;;
  esac
  if [ -n "$fichiers" ]; then
    printf '# Option IA, écrit par install.sh selon la carte graphique détectée\nCOMPOSE_FILE=%s\n' "$fichiers" >> "$CIBLE/.env"
    echo "  Option IA possible ($option, $vram_max Mo de mémoire graphique) : Ollama sera installé, le modèle se choisit dans ODIN."
  else
    case "$raison" in
      pilote) echo "  Carte NVIDIA détectée sans son pilote : option IA indisponible (voir la page Assistant IA)." ;;
      toolkit) echo "  Carte NVIDIA détectée, mais Docker ne peut pas l'utiliser (NVIDIA Container Toolkit absent) : option IA indisponible." ;;
      rocm) echo "  Carte AMD détectée sans ROCm (/dev/kfd absent) : option IA indisponible." ;;
      memoire) echo "  Carte graphique trop petite ($vram_max Mo, il en faut 8 Go) : ODIN fonctionne en recherche avancée." ;;
      *) echo "  Aucune carte graphique compatible : ODIN fonctionne en recherche avancée, sans IA." ;;
    esac
  fi
}
detecter_materiel || echo "  Avertissement : détection du matériel impossible, option IA désactivée."

msg "Espace disque"
# Docker keeps its images on the system disk (DockerRootDir, /var/lib/docker): about 2.5 GB without the
# AI option, 12 GB more with it (Ollama image and a model). An update only brings new versions.
libre_mo() { df -Pm "$1" | awk 'NR==2 {print $4}'; }
RACINE_DOCKER=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
[ -d "$RACINE_DOCKER" ] || RACINE_DOCKER=/
BESOIN_MO=5120
grep -q '^COMPOSE_FILE=.*compose\.ia\.yml' "$CIBLE/.env" && BESOIN_MO=20480
[ -n "$AVANT" ] && BESOIN_MO=2048
LIBRE_SYSTEME=$(libre_mo "$RACINE_DOCKER")
LIBRE_DONNEES=$(libre_mo "$DATA")
echo "  Disque système (images Docker) : $((LIBRE_SYSTEME / 1024)) Go libres. Données : $((LIBRE_DONNEES / 1024)) Go libres."
[ "$LIBRE_SYSTEME" -ge "$BESOIN_MO" ] \
  || err "Place insuffisante sur le disque système ($RACINE_DOCKER) : $((LIBRE_SYSTEME / 1024)) Go libres, il en faut $((BESOIN_MO / 1024)). Libérez de la place (docker system prune, anciens fichiers), puis relancez l'installeur."
if [ "$LIBRE_DONNEES" -lt 10240 ]; then
  echo "  Attention : moins de 10 Go libres pour les données. Les contenus (packs, livres, cartes) en demandent souvent davantage."
fi

msg "Modèle de la recherche avancée"
# EmbeddingGemma for llama.cpp (service « vecteurs »). Downloaded now and checked: offline, the
# search never fetches anything. Pinned revision and SHA-256; a file that fails the check is dropped.
VECTEURS_FICHIER=embeddinggemma-300M-Q8_0.gguf
VECTEURS_SOURCE="https://huggingface.co/ggml-org/embeddinggemma-300M-GGUF/resolve/0f741b5a6585bd53aeb15cd1372c56f2a0f65e12/$VECTEURS_FICHIER"
VECTEURS_SHA256=b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63
modele_vecteurs() {
  local f="$DATA/vecteurs/$VECTEURS_FICHIER"
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
    if [ -d "$DATA/$d" ]; then rm -rf "${DATA:?}/$d"; retire=1; fi
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
# goes too. data/ollama is left in place (models the AI option may reuse): the end of the installation
# says how to delete it.
if ! grep -q '^COMPOSE_FILE=.*compose\.ia\.yml' .env; then
  img=$(docker image ls -q ollama/ollama | sort -u)
  if [ -n "$img" ] && [ -z "$(docker ps -aq --filter 'name=^ollama$')" ]; then
    docker image rm -f $img >/dev/null 2>&1 && echo "  Ollama retiré : l'IA devient une option, la recherche n'en a plus besoin."
  fi
  # Shown at the very end, with the command: never deleted by the installer
  if [ -d "$DATA/ollama" ] && [ -n "$(ls -A "$DATA/ollama" 2>/dev/null)" ]; then
    NOTE_OLLAMA="$(du -sh "$DATA/ollama" | cut -f1)"
  fi
fi
# --- End of migration ---

msg "Anciennes images"
# Every update brings a new dashboard image (about 450 MB). Kept: the images in use and, for each
# service, the most recent previous one (to go back if an update goes wrong). The others are removed.
# Only ODIN's images are touched.
nettoyer_images() {
  local utilisees repo id ref garde avant apres
  avant=$(libre_mo "$RACINE_DOCKER")
  utilisees=$(docker ps -aq | xargs -r docker inspect --format '{{.Image}}' | sort -u)
  for repo in ghcr.io/gorgo126/odin-dashboard ghcr.io/ggml-org/llama.cpp ghcr.io/kiwix/kiwix-serve gtstef/filebrowser caddy ollama/ollama; do
    garde=""
    # Most recent first
    while read -r id ref; do
      grep -q "$id" <<<"$utilisees" && continue
      if [ -z "$garde" ]; then garde=$id; continue; fi
      [ "$id" = "$garde" ] && continue
      case "$ref" in *'<none>'*) ref=$id ;; esac
      docker image rm "$ref" >/dev/null 2>&1 || true
    done < <(docker image ls --no-trunc --format '{{.ID}} {{.Repository}}:{{.Tag}}' "$repo")
  done
  apres=$(libre_mo "$RACINE_DOCKER")
  if [ "$apres" -gt "$avant" ]; then echo "  $((apres - avant)) Mo libérés sur le disque système."; else echo "  Rien à retirer."; fi
}
nettoyer_images || echo "  Avertissement : nettoyage des anciennes images incomplet."

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
if [ -n "${NOTE_OLLAMA:-}" ]; then
  echo "  Place à récupérer : $DATA/ollama ($NOTE_OLLAMA) contient des modèles d'IA qui ne servent"
  echo "  pas sans carte graphique compatible. Pour le supprimer :"
  echo "    sudo rm -rf $DATA/ollama"
  echo
fi

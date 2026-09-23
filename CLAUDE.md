# ODIN  Offline Data & Information Node

Serveur de connaissances hors ligne, installable en une commande sur Ubuntu/Debian.
Inspiré de Project NOMAD, reconstruit de zéro, en plus simple, pensé francophone.
Le propriétaire préfère avancer vite et concrètement. Réponses en français.

## Principe hors ligne

ODIN sert là où il n'y a pas d'internet. Internet sert à le préparer (installation, contenus,
modèles d'IA), jamais à le faire fonctionner. Un serveur ODIN doit démarrer, redémarrer et servir
toutes ses pages sans aucun accès extérieur, et ne rien envoyer dehors.

- Seules exceptions permises : ajouter du contenu (catalogue et téléchargement Kiwix) et
  installer ou mettre à jour ODIN. Hors ligne, elles échouent vite (quelques secondes au plus) et
  le disent clairement ; jamais de blocage ni d'attente sans limite.
- Tout appel réseau sortant du code ODIN a un délai (AbortSignal.timeout), y compris
  pendant qu'un flux se télécharge. Exceptions voulues : les packs de cartes n'ont pas de délai
  d'inactivité (pmtiles extract a une longue phase de préparation silencieuse) ; les livres non plus, mais
  gardent 15 s au plus pour obtenir la réponse HTTP. Dans les deux cas, l'annulation est manuelle.
- Aucun CDN, police externe, analytique ou vérification de mise à jour. Pour une image tierce,
  désactiver ces fonctions par variable d'environnement (Ollama : OLLAMA_NO_CLOUD=true).
- Tout ce qu'un service télécharge au premier usage (modèles, index, caches) doit être
  téléchargé pendant l'installation, pas à la première utilisation hors ligne.
- Toute nouvelle fonction qui touche au réseau passe le test hors ligne (voir « Test hors ligne »).

## Flux de travail

Ce dépôt, sur Windows, est le seul endroit où le code se modifie.
Le serveur de test est la VM Multipass "nomad" (Ubuntu 24.04, 192.168.129.19), où le dépôt est
cloné dans /opt/odin. Ne jamais y modifier de fichier directement : il ne fait que git pull.

- On travaille sur la branche dev. nomad suit dev.
- Pour tester : commit et push sur dev, puis
  multipass exec nomad -- bash -lc "cd /opt/odin && git pull && docker compose -f compose.yml -f compose.dev.yml up -d --build --remove-orphans"
  (--remove-orphans retire les conteneurs d'un service supprimé de compose.yml ; install.sh fait de même)
  Si le .env de nomad porte COMPOSE_FILE (option IA, simulée sur nomad depuis le lot 5), les -f l'ignorent
  et --remove-orphans supprimerait Ollama : ajouter -f compose.ia.yml avant -f compose.dev.yml.
  Revenir sans IA sur nomad : relancer l'installeur sans ODIN_SIMULER_VRAM (il retire la ligne COMPOSE_FILE).
- Le propriétaire vérifie dans son navigateur sur http://192.168.129.19
- Une fois validé : fusionner dev dans main et pousser. C'est main que récupère l'installeur.
- Image du dashboard : à chaque push sur main ou dev touchant dashboard/, GitHub Actions publie
  ghcr.io/gorgo126/odin-dashboard:<sha> puis fige le compose.yml de cette branche sur cette image, par
  un commit automatique (github-actions[bot]). Faire git pull avant de repousser. L'installeur prend
  donc l'image de la branche clonée (BRANCHE). Suivre un build : gh run list / gh run watch.
- Revenir sur nomad à l'image publiée : ... && docker compose pull dashboard && docker compose up -d --remove-orphans
- Logs : multipass exec nomad -- bash -lc "cd /opt/odin && docker compose logs --tail 50 <service>"
- Tester une route interne sans authentification :
  multipass exec nomad -- docker exec caddy wget -qO- http://dashboard:3000/...

Avant une modification importante, proposer un snapshot :
multipass stop nomad && multipass snapshot nomad --name <nom> && multipass start nomad
Ne jamais restaurer ni supprimer une VM sans l'accord explicite du propriétaire.

Toute modification de install.sh doit être validée sur une VM vierge :
multipass launch 24.04 --name test --cpus 4 --memory 8G --disk 40G --network Ethernet
puis curl de install.sh depuis raw.githubusercontent.com/Gorgo126/ODIN/<commit>/install.sh et
sudo BRANCHE=dev bash (défaut : main ; la variable se place après sudo, sinon sudo l'efface) :
multipass exec test -- bash -lc "curl -fsSL https://raw.githubusercontent.com/Gorgo126/ODIN/<commit>/install.sh | sudo BRANCHE=dev NOM_HOTE=test bash"
NOM_HOTE=test est obligatoire sur une VM vierge : sinon la VM se renomme "odin" et, au redémarrage, Multipass ne la
joint plus (il la cherche sous test.mshome.net). Arrêter/démarrer la VM : multipass stop test / start test.
Supprimer ensuite la VM de test (multipass delete test --purge), jamais nomad.
Recherche avancée et option IA : VM vierge et test hors ligne faits au lot 7 (2026-09-23), voir « Disques ».
La VM vierge installe l'image publiée pour la branche : après un push touchant le dashboard,
attendre le commit automatique de GitHub Actions et installer depuis ce commit.
Mémoire : nomad et test (8 Go chacune) ne tiennent pas ensemble ; arrêter nomad pendant le test.

### Test hors ligne

Sur une VM test, jamais sur nomad (il modifie le pare-feu du système). Coupe internet mais garde
le réseau local, comme une box sans accès internet ; chaque tentative bloquée est journalisée.

1. Préparer en ligne (VM vierge ci-dessus) : mot de passe, un petit pack (climat), un PDF dans
   Documents.
2. Couper : sudo /opt/odin/scripts/hors-ligne.sh couper (persiste au redémarrage).
3. Redémarrer à froid (multipass stop test, puis multipass start test), puis vérifier : 5 conteneurs, connexion,
   accueil, recherche, lecteur, /kiwix, dépôt d'un document,
   page Configuration (« Catalogue injoignable » en moins de 3 s, boutons désactivés).
4. Navigateur, outils de développement ouverts (onglet Réseau) : aucune requête vers un autre hôte
   que l'IP d'ODIN, sur chaque page. Indispensable : le PC du propriétaire, lui, a internet.
5. Tentatives bloquées : sudo /opt/odin/scripts/hors-ligne.sh journal. Seul le catalogue Kiwix
   (page Configuration) est attendu ; toute autre ligne est une dépendance à corriger.
6. Coupure pendant un téléchargement : rétablir, lancer un gros pack, couper au milieu.
   Attendu : erreur en moins d'une minute, « Réessayer » reprend une fois internet revenu.
7. Rétablir : sudo /opt/odin/scripts/hors-ligne.sh retablir

## Architecture

Un seul compose.yml écrit à la main, aucun orchestrateur.

- caddy : façade unique, port ${HTTP_PORT}:80. Routes /documents  filebrowser,
  /kiwix  kiwix, reste  dashboard. auto_https off.
  Après toute modification du Caddyfile : docker compose restart caddy (up -d ne le relit pas).
- Authentification unique : forward_auth vers /api/auth/verifier du dashboard. Mot de passe choisi à la
  première visite (data/config/auth.json). Les chemins accessibles sans connexion sont listés dans @public.
- dashboard : Next.js 15 (app router, output standalone) dans dashboard/. Dépendances : Next, React, et pour
  la carte seulement maplibre-gl, pmtiles et @protomaps/basemaps, en versions exactes. Rien d'autre.
- kiwix : moteur invisible, lit data/zim/library.xml (--monitorLibrary, --skipInvalid).
- vecteurs : llama.cpp (ghcr.io/ggml-org/llama.cpp:server-v0.4.1) sert EmbeddingGemma sur le processeur pour
  la recherche avancée et l'index (VECTEURS_URL=http://vecteurs:8080, /v1/embeddings), réseau interne seulement.
  Modèle data/vecteurs/embeddinggemma-300M-Q8_0.gguf (MODELE_VECTEURS), téléchargé par install.sh avant le
  démarrage (révision Hugging Face figée, SHA-256 vérifié, transfert bloqué coupé après 60 s). Point d'entrée
  sh : -t $(nproc) (seul, llama.cpp ne prend que la moitié des cœurs). Port 8080 explicite (le défaut va changer).
- ollama : option IA seulement, dans compose.ia.yml (activé par COMPOSE_FILE dans .env) avec OLLAMA_URL pour le
  dashboard (MODELE_CHAT_FORCE dans .env force un modèle ; l'ancien MODELE_CHAT des .env est ignoré). Sans lui : pas de résumés par le modèle, /api/assistant/question
  répond 503 « L'assistant IA n'est pas installé ». Absent de l'installation par défaut depuis le lot 4 ;
  install.sh (migration) retire son image sans l'option IA et laisse data/ollama avec une note.
- filebrowser : FileBrowser Quantum (gtstef/filebrowser), noauth, config/filebrowser.yaml.
- Cartes : packs PMTiles (fonds Protomaps, données OSM) dans data/cartes/<id>.pmtiles, servis par
  Caddy sur /tuiles/* (file_server, requêtes Range, derrière l'authentification). Catalogue :
  catalogue/cartes.txt (id|ouest,sud,est,nord ou -|zoom max|libellé). Un pack = pmtiles extract
  du build mondial ; sans zone et en zoom 15, c'est le fichier mondial entier, téléchargé directement
  (reprise possible). Le nom du build est daté : lu dans build-metadata.protomaps.dev/builds.json,
  le plus récent au schéma 4.x (celui du style figé). "fond" (monde, zoom 6, ~45 Mo) est installé par
  install.sh via l'API du dashboard et ne se supprime pas.
  Le binaire pmtiles vient de l'image figée ghcr.io/protomaps/go-pmtiles (étape du Dockerfile du dashboard).
  Page /carte (MapLibre GL) : une source par pack, empilées du moins au plus détaillé ; la terre et
  l'eau opaques d'un pack détaillé masquent les packs en dessous, les étiquettes passent toutes au-dessus.
  Glyphes et sprites Protomaps (basemaps-assets, commit figé, empreinte vérifiée) téléchargés au build
  de l'image dans public/ressources-carte/.

Images Docker figées sur une version précise dans compose.yml (jamais latest, main ni stable).
Une montée de version se fait volontairement, une image à la fois, après test sur nomad puis hors ligne.
Le dashboard est figé sur l'image de son commit (ghcr.io/gorgo126/odin-dashboard:<sha complet>),
mise à jour automatiquement par GitHub Actions sur chaque branche (voir Flux de travail).

- Connectivité externe (« liaison » dans le code : lib/liaison.mjs, /api/liaison, useLiaison) : sonde côté serveur (lib/liaison.mjs), lancée au démarrage par instrumentation.js,
  toutes les 45 s : TCP 443 vers LIAISON_CIBLES (délai 2,5 s, en parallèle) et résolution DNS de
  LIAISON_DNS. Établie = 2 cibles et DNS ; dégradée = 1 cible, ou DNS en échec ; rompue = aucune.
  /api/liaison renvoie le dernier résultat sans jamais attendre un test. Dernier contact (dernier état
  établi) dans data/config/liaison.json. Réglages (mode auto / forcé hors ligne / forcé en ligne,
  silence radio, liens monde) dans data/config/reglages.json, via /api/reglages.
  Source de vérité unique : enLigne() côté serveur, useLiaison() côté navigateur. Toute fonction qui
  demande internet passe par elles (grisée avec « Indisponible hors ligne », jamais cachée) ; aucun
  appel externe sans elles, et aucun en silence radio.
- Livres (packs PDF, docs/conception-packs-documents.md) : catalogue/livres.json porte toutes les
  métadonnées, dont la taille et le SHA-256. lib/livres.mjs télécharge chaque source dans l'ordre (source
  officielle, puis miroir), sans reprise d'une source à l'autre, vérifie l'empreinte sur le fichier complet
  et ne garde jamais un fichier non vérifié. L'installation se prépare dans data/livres/.en-cours puis est
  renommée en une fois vers data/livres/<id>/ (document.pdf, fiche.json). Une entrée invalide du catalogue
  est ignorée avec un message dans les logs.
  Lecture : /livres (fiches d'attribution), /livres/<id>?page=N. Caddy sert seulement <id>/document.pdf sur
  /livres-fichiers/* (requêtes Range, derrière l'authentification). Visionneuse pdf.js : archive legacy
  figée et vérifiée dans le Dockerfile (public/pdfjs, fichiers statiques, sans lien avec Node), réglée
  par l'événement webviewerloaded (disableStream, disableAutoFetch : seules les pages affichées sont
  téléchargées), sans toucher à ses fichiers.
  Recherche : à l'installation (et au démarrage pour un livre sans texte), pdftotext (poppler-utils, dans
  l'image) écrit data/livres/<id>/pages.json, page par page avec le chapitre tiré de l'en-tête courant.
  lib/recherche-livres.mjs garde le texte normalisé en mémoire (lib/normalisation.mjs : sans accents ni
  casse, partagé avec le navigateur). /recherche montre « Dans les livres » au-dessus des résultats Kiwix ;
  le lien ouvre /livres/<id>?page=N&q=…, où la visionneuse surligne les mots sur cette page seulement
  (la recherche de pdf.js, #search=, téléchargerait tout le livre).

- Recherche avancée (produit principal depuis le 2026-09-23 ; l'IA devient une option GPU). Plan en lots :
  0 remise à plat (fait), 1 moteur et 2 page (faits ensemble), 3 table de synonymes et mesure des trois
  configurations (BM25 + synonymes, hybride Ollama, hybride llama-server : le propriétaire tranche les
  embeddings), 4 service de vecteurs léger, 5 matériel et page d'installation de l'IA, 6 assistant branché
  sur la recherche, 7 installeur final (VM vierge, test hors ligne). Les « lot N » plus bas dans la section
  Assistant documentaire renvoient à l'ancien plan (ancien lot N).
  /recherche : au-dessus des résultats par mots-clés (inchangés), app/recherche/Passages.jsx appelle
  /api/recherche (index.rechercher sur les trois sources, puis assistant/passages.mjs : un groupe par document,
  3 passages au plus, fenêtre de 420 caractères autour du premier mot, mots surlignés). Aucun modèle de langage.
  Niveaux par les seuils de cosinus de chaque source (fort ≥ reponse, proche ≥ proches, sinon écarté) ; sans
  vecteurs, par la couverture (part de la requête trouvée, pondérée par l'idf, mots absents de tous les passages
  ignorés : CONSTANTES.couverture, provisoire). Bandeau d'urgence en tête (securite.mjs, textes
  CONSTANTES.bandeauUrgence, au vouvoiement). ?debug=1 : scores et règles de chaque passage.
  Compréhension (lot 3) : catalogue/synonymes.json, écrite à la main (dit → cherche, le premier est le terme
  principal, aussi à poids 0,5), appliquée par assistant/synonymes.mjs (accents et casse ignorés, pluriel et
  féminin, expression la plus longue d'abord, relue quand le fichier change). assistant/recherche-avancee.mjs
  (route et évaluation) : requêtes Kiwix = phrase, termes de la table, mots seuls (accents gardés, 6 au plus) ;
  question vectorisée avec ses termes. Termes de la table alignés sur des titres qui existent dans les packs.
  Mesure (nomad, 2026-09-23, tests/recherche.json : 33 questions + 3 hors sujet, dashboard/assistant/
  evaluation-recherche.mjs) : phrase brute hybride 10/33 en tête, 12/33 trouvées ; BM25 + synonymes 15/33
  en tête avec les seuils de couverture (sans seuil : 18/33 en tête, 32/33 dans les 3 premiers, MRR 0,74,
  1 hors-sujet sur 3 mal écarté), 0,35 s ; hybride + synonymes 31/33 en tête, 33/33 dans les 3 premiers,
  MRR 0,97, 3/3 hors sujet écartés, 1,9 s (Ollama) comme 2,0 s (llama.cpp). llama.cpp server-v0.4.1 avec
  ggml-org/embeddinggemma-300M-Q8_0.gguf (334 Mo, sha256 b5ce9d77…0d63) : vecteurs à 0,9997 de ceux
  d'Ollama (mêmes classements), image 1,2 Go contre 9,2 Go, 554 Mo de RAM en charge contre 943 Mo.
  Le 31/33 est OPTIMISTE : 6 expressions de la table ont été corrigées d'après les échecs de la première
  mesure (27/33 avant). Le propriétaire écrira lui-même une série de questions pour l'éprouver.
  Lot 4 (vecteurs par llama.cpp, installé par install.sh sur nomad) : même score 31/33, 2,2 s par question,
  indexation 4,4 morceaux/s (3,05 avec Ollama), 450 Mo de RAM ; un index construit par Ollama reste valide.
  Candidats de l'option IA (relevés le 2026-09-23, à refaire au lot 5 avec ce qui existera alors) :
  tranche 8 Go : qwen3:8b-q4_K_M (5,2 Go, texte, Apache 2.0, hybride : think false, respecté par qwen3:1.7b
  de la même famille, à revérifier) ; granite4:tiny-h (4,2 Go, texte, Apache 2.0, MoE 7B dont 1B actif,
  français non vérifié). Tranche 16 Go : qwen3:14b-q4_K_M (9,3 Go, texte, Apache 2.0, think false) ;
  ministral-3:14b-instruct-2512-q4_K_M (9,1 Go, Apache 2.0, encodeur d'images inclus). Écartés : Gemma 3
  (texte seul en 1b et 270m seulement, licence Gemma), Mistral Small 3.x (24B, 15 Go), ministral-3:8b
  (6 Go avec l'encodeur d'images). Replis de 2024 : qwen2.5:7b/14b-instruct, llama3.1:8b, mistral-nemo:12b.
- Option IA (lot 5). CHEMIN GPU NON VÉRIFIÉ : aucune carte pour tester (nomad est une VM ; seul le parcours
  en simulation est testé). install.sh (« Matériel pour l'option IA ») liste les cartes par sysfs (classe 03xx ;
  noms par lspci s'il existe), mémoire des cartes NVIDIA par nvidia-smi, AMD par mem_info_vram_total ; runtime
  nvidia de Docker (docker info) ; /dev/kfd pour AMD. Écrit data/config/materiel.json (cartes, option, raison :
  aucune, memoire, pilote, toolkit, rocm) et, si une carte d'au moins 7 680 Mo est utilisable, la ligne
  COMPOSE_FILE=compose.yml:compose.ia.yml:compose.nvidia.yml (ou compose.amd.yml, image 0.34.2-rocm) dans .env,
  précédée d'un commentaire ; sinon il retire cette ligne. ODIN_SIMULER_VRAM=<Mo> simule une carte NVIDIA :
  COMPOSE_FILE=compose.yml:compose.ia.yml, Ollama sur le processeur. Ollama n'est donc téléchargé que sur une
  machine qui peut s'en servir ; le modèle, seulement quand l'utilisateur le choisit.
  catalogue/modeles-ia.json : qwen3:8b-q4_K_M (8 Go, empreinte 500a1f067a9f) et qwen3:14b-q4_K_M (16 Go,
  bdbd181c33f2), texte seul, Apache 2.0, think false ; qwen3:0.6b-q4_K_M (essai) visible seulement en simulation.
  Choix fait au lot 5 parmi les candidats ci-dessus, modifiable dans ce fichier sans toucher au code.
  lib/ia.mjs, /api/ia, page /ia : cas (impossible avec la raison et la marche à suivre, 8 ou 16), modèles grisés
  avec la raison, un seul modèle installé à la fois, espace disque (taille + 1 Go, statfs de /data),
  téléchargement par /api/pull (progression, 2 min d'inactivité, annulation, reprise des couches par Ollama),
  empreinte vérifiée (avertissement si le tag a bougé), test de chargement (/api/generate puis /api/ps :
  part du modèle en mémoire graphique ; avertissement si débordement sur le processeur), activer, désinstaller.
  data/config/ia.json : modèle, actif, vérification. L'assistant n'existe que si OLLAMA_URL et un modèle actif ;
  sinon la carte de l'accueil est grisée « Non installé » et mène à /ia.
  Vérifié en simulation sur nomad (2026-09-23) : 14B refusé (8 Go), essai téléchargé, empreinte bonne, test
  gpu 0 (processeur, attendu en simulation).
  Test GPU réel : NON FAIT. Le PC du propriétaire a une RTX 3080 (10 Go, pilote 610.88) visible par nvidia-smi
  dans WSL ; le test prévu passait par Docker Desktop/WSL2 (docker run --gpus all), sans rien installer. Docker
  Desktop n'est plus présent (désinstallé le 2024-04-21) : test abandonné, rien installé ni modifié sur ce PC.
  Restent donc non vérifiés : le passage du GPU au conteneur Ollama (compose.nvidia.yml, compose.amd.yml), le
  chargement en mémoire graphique et le temps de réponse, la détection du matériel et l'installation des
  pilotes sur une vraie machine Ubuntu, et une carte de 8 Go exactement (seuil 7 680 Mo).
- Assistant documentaire (ancien plan, anciens lots 1 à 4 faits ; devient l'option IA) : remplace Open WebUI et
  synchro, retirés à l'ancien lot 1.
  Décisions validées : UI, API et ingestion dans le dashboard ; Node 24 pour node:sqlite (FTS5), aucune
  dépendance npm ajoutée ; pas de sqlite-vec ; OLLAMA_MAX_LOADED_MODELS=2 et keep_alive (30m) sur les deux
  modèles ; /assistant et son API derrière l'authentification, flux non tamponné par Caddy.
  qwen3:4b désigne la version « thinking » : figer qwen3:4b-instruct-2507-q4_K_M. install.sh contient un bloc
  de migration (retrait d'Open WebUI, synchro, qwen2.5:3b, bge-m3, data/openwebui, data/synchro), à retirer
  après la v1.
  Index (ancien lot 2) : dashboard/assistant/*.mjs tourne dans un worker_thread (jamais sur la boucle d'événements
  de Next), lancé par lib/assistant.mjs depuis instrumentation.js (état dans globalThis). Ces fichiers et lib/
  sont copiés tels quels dans l'image (hors bundle Next) : le worker ne doit importer que des modules Node
  et des fichiers de lib/ sans dépendance. Base data/assistant/index.db : fichiers (statut indexe, ignore
  = format non pris en charge, erreur, attente = Ollama indisponible, réessayé au scan suivant), morceaux
  (texte, page, section, vecteur Float32 complet en BLOB) et morceaux_fts (FTS5 sans contenu, texte
  normalisé par lib/normalisation.mjs). Vecteurs chargés en mémoire, coupés à ASSISTANT_DIMENSIONS (0 = tous)
  et renormalisés : changer de dimensions ne demande pas de réindexer, changer de modèle vide l'index.
  Formats : PDF (pdftotext, page par page), MD, TXT (UTF-8, sinon Windows-1252), DOCX (lecteur ZIP maison,
  zlib), HTML. Morceaux d'environ 400 jetons (1 jeton ≈ 4 caractères), chevauchement 55, coupés aux
  paragraphes et aux titres. Incrémental : taille + date, puis empreinte SHA-256. Déclenchement : démarrage,
  fs.watch récursif (3 s de délai), scan toutes les 5 min, POST /api/assistant/index ({"complet": true}
  pour tout refaire). Préfixes d'EmbeddingGemma toujours appliqués (assistant/embeddings.mjs).
  Recherche : BM25 (mots de 4 lettres et plus en préfixe) + cosinus, 20 candidats chacun, fusion RRF (k=60),
  4 extraits ; le meilleur cosinus brut est rendu à part (seuils de l'ancien lot 3). Sans Ollama, mots-clés seuls.
  Appels Ollama : délai d'inactivité (120 s, en-têtes ou données), jamais de délai total.
  Priorité aux questions : une recherche coupe l'appel d'indexation en cours (refait ensuite) et suspend
  l'indexation jusqu'à la fin de la réponse (jeton rendu par rechercher({ garder: true }), reprendre(jeton),
  reprise forcée après 5 min). Les résumés d'une ligne (modèle de langage, après l'indexation) cèdent aussi.
  PDF dont le texte fait moins de 30 lettres par page : statut probleme, « PDF sans texte (probablement scanné) ».
  Réponse (ancien lot 3) : assistant/reponse.mjs (générateur d'événements etat/texte/fin/erreur, sans dépendance à
  Next, partagé par la route et l'évaluation), prompt.mjs (noyau verrouillé + personnalité, exemples en tours
  de dialogue, rappel du tutoiement dans le dernier message : les petits modèles suivent le dernier message),
  reglages.mjs. Réglables dans Configuration, et seuls enregistrés dans data/config/assistant.json :
  nom, avatar, couleur, ton, tutoiement, longueur. Tout le reste (formulations « je ne sais pas »,
  messages de secours, modèles, extraits, seuils, température, mémoire, message d'accueil) est figé dans
  assistant/constantes.mjs ; valider() reconstruit l'objet, donc un ancien fichier plus riche voit ses
  clés inconnues ignorées. Mode debug : par l'adresse /assistant?debug=1 seulement, jamais enregistré.
  Avatars : 10 sprites en pixel art dessinés dans app/assistant/Sprite.jsx (grille 16 × 16, un rect SVG
  par pixel, couleur de l'utilisateur sur fond sombre) ; aucune image à téléverser, aucun fichier.
  Réponse sur la recherche avancée (lot 6, assistant/reponse.mjs) : même recherche que /recherche (preparer de
  recherche-avancee.mjs : table de synonymes, trois sources) ; le modèle ne reformule qu'une question de suite
  (contexte.mjs). Issue décidée par le meilleur cosinus avant tout appel : 1 = une source ≥ son seuil de réponse
  → réponse rédigée ; 2 = sous ce seuil (ou [NON_TROUVE] en début de flux, ou vecteurs absents) → phrase fixe et
  passages, aucune rédaction ; 3 = rien → « je ne sais pas » ; 4 = repli : le modèle échoue, ne donne pas son
  premier mot en 60 s (cfg.delaiPremierMot), ou cite un chiffre absent des passages envoyés (sansInvention) →
  son texte est jeté, la raison et les passages s'affichent. Les passages (groupes de passages.mjs, champ
  resultats de l'événement fin) accompagnent toute réponse : repliés sous une réponse rédigée, ouverts sinon
  (composant partagé app/recherche/Groupe.jsx). Au plus reglages.extraits (4) passages vont au modèle, à moins
  de 0,1 du meilleur cosinus (ou 1er par mots-clés), le guide médical gardé en cas d'urgence. Après un appel,
  /api/ps (1,5 s au plus) : modèle en partie ou entièrement hors de la carte graphique → avertissement sous la
  réponse. Sans modèle actif, /assistant redirige vers /ia. Replis testés contre un faux Ollama (scratchpad) ;
  pas de test de bout en bout avec un vrai modèle depuis le retour de nomad hors simulation.
  Renvois : le modèle numérote les extraits, l'affichage numérote les sources. Les passages d'un même
  document deviennent une source, numérotée dans l'ordre de citation, et le texte final (champ texte de
  l'événement fin) porte ces numéros. La ligne des sources ne liste que les sources citées :
  « WikiMed · Brûlure », « Livre · Là où il n'y a pas de docteur, p. 164 », « Mes documents · … ».
  Route POST /api/assistant/question : NDJSON en flux (Cache-Control no-transform : sinon la compression de
  Next retient les morceaux) ; Caddy le laisse passer sans tampon (vérifié). /api/assistant/* sans connexion :
  401 JSON (verifier/route.js) ; les pages restent en redirection. Sources : PDF dans la visionneuse
  (/assistant/document?chemin=&page=), autres fichiers par Caddy sur /fichiers-documents/* (lecture seule,
  CSP sandbox). Ce préfixe ne doit pas commencer par /documents, déjà pris par FileBrowser (handle /documents*).
  Modèle de langage : celui de l'option IA (lot 5, page /ia). Options identiques à chaque appel (num_ctx 4096, num_thread = cœurs,
  think false) : une valeur différente recharge le modèle. Ollama garde en cache le début commun du prompt
  (noyau + exemples) : ne rien y mettre qui change à chaque question.
  Conversation (assistant/conversation.mjs) : règles fixes, jamais le modèle. Message de 6 mots au plus
  dont tous les mots sont du vocabulaire de politesse (salutation, remerciement, acquiescement, au
  revoir) : réponse toute faite, aucun appel. Tout le reste part en recherche (« comment faire du feu ? »).
  Compréhension par le modèle (assistant/comprehension.mjs), seulement pour une question de suite depuis le
  lot 6 : JSON strict (format = schéma Ollama) pour reformuler seulement : question autonome, requête (mots-clés + termes médicaux et synonymes), terme principal,
  drapeaux sante et gravite. JSON invalide : la phrase brute.
  Contexte (assistant/contexte.mjs) : l'échange précédent n'est joint à la compréhension que si la
  question ne tient pas debout seule (moins de 5 mots, début et/donc/alors/pourquoi/comment ça/et si,
  pronom ou démonstratif sans référent, ou aucun mot hors mots outils). Sinon elle est traitée seule :
  une question complète ne doit jamais être relue à travers la précédente. Garde-fou : si la requête
  réécrite ne partage aucun mot significatif avec la question, la reformulation est jetée.
  Le modèle de rédaction ne reçoit jamais l'échange précédent, seulement les passages et la question.
  Questions sur l'assistant (« qui es-tu ? ») : règles dans conversation.mjs, réponse fixe bâtie sur
  les réglages (CONSTANTES.presentation), sans recherche.
  Sécurité (assistant/securite.mjs) : seuls les signes vraiment graves (perte de connaissance, respiration,
  douleur thoracique, saignement abondant, brûlure étendue ou profonde, fracture ouverte, convulsion,
  intoxication, noyade, électrisation, et appel au suicide) déclenchent l'avertissement, par règles sur la
  question ; le drapeau du modèle n'est suivi que hors blessures courantes (coupure au doigt, petite
  brûlure, mal de tête). L'avertissement conclut alors la réponse (les gestes se lisent d'abord),
  dans les trois issues. Son texte dépend du réseau : trois formulations dans constantes.mjs
  (urgences.disponible, .indisponible, .inconnu). Aucun numéro d'urgence : il dépend du pays, et le
  texte dit seulement « les secours ». Aucune ne dit de
  ne pas appeler : ODIN sans internet ne veut pas dire que le téléphone est coupé. L'état vient de la
  sonde de « Connectivité externe » (lib/liaison.mjs, rafraîchie toutes les 45 s, lue sans attendre) :
  jamais de seconde sonde, et sans réponse en 500 ms c'est le texte « état inconnu ». Jamais
  d'avertissement sur une question de santé ordinaire.
  Guides médicaux : livre dont la fiche porte avertissement « sante », pack Kiwix dont le titre parle de
  médecine ou de santé. En cas d'urgence, leur meilleur passage est toujours envoyé au modèle, et une
  urgence sans autre résultat passe en issue 2 sur ces guides, pour renvoyer à la bonne page.
  Sources : Mes documents (index), Wiki (wikis.mjs : ZIM avec _ftindex:yes lu dans le catalogue OPDS
  LOCAL, deux requêtes en parallèle, 15 articles, paragraphes ≥ 60 caractères coupés à 700, BM25 local,
  8 vectorisés ; bonus BM25 quand le titre de section contient les mots de la requête), Livres
  (source-livres.mjs : pages.json des livres installés, 4 paragraphes vectorisés).
  Packs et livres ajoutés ou retirés sont pris en compte sans redémarrage : catalogue Kiwix relu au plus
  toutes les 60 s (et tout de suite si une recherche échoue, pack retiré), livres relus à chaque question
  d'après la date de pages.json.
  Classement commun par cosinus ; le meilleur résultat par mots-clés des documents garde sa place.
  Terme principal (assistant/terme.mjs) : celui de la compréhension s'il ne contient que des mots venus
  de la question (comparaison par racine), sinon le plus long titre d'article trouvé que la question contient
  mot pour mot (termeDuTitre, 4 lettres au moins, parenthèses ignorées), sinon le mot le plus rare de la
  question parmi les passages trouvés, sinon aucun. Sans terme sûr, les règles de titre ne s'appliquent pas. Elles pèsent sur le
  BM25 local (assistant/bm25.mjs) : titre exact ×3, titre commençant par le terme avec un mot de plus
  au maximum ×1,8, cas particulier (le terme plus deux mots ou plus, absents de la question) ×2/3 mais
  seulement si un article général figure parmi les candidats, section de la liste fermée
  (CONSTANTES.sectionsGenerales, égale ou au début du titre de section, jamais au milieu) ×1,4. Le mode debug montre le score brut, le terme retenu et les
  règles appliquées à chaque passage.
  Seuils par source (reglages.mjs). Santé ou sécurité : rappel du 112 toujours ajouté.
  Morceaux : un titre ferme le morceau dès 25 jetons (une section par morceau : sinon le modèle mêle
  les consignes). OLLAMA_NUM_PARALLEL=2 : compréhension et réponse gardent chacune leur cache de prompt.
  Évaluation : tests/generer-documents.py écrit tests/documents (10 documents fictifs, 5 formats) ;
  tests/questions.json (10 réponses, 5 proches, 5 hors sujet) ; assistant/evaluation.mjs (commande en tête).
  Banc : docker exec -i dashboard node assistant/banc.mjs < tests/banc-embeddings.json (travaille dans
  /tmp du conteneur ; le modèle comparé doit être présent dans Ollama, à retirer ensuite).
  Résultat du banc (nomad, 2026-09-22, livre de 639 pages, 1453 morceaux, 5 questions) : embeddinggemma:300m
  en 768 dimensions retenu (MRR vecteurs 0,90 ; 256 d : 0,85 ; bge-m3 : 0,75), 1,7 morceau/s contre 0,7 pour
  bge-m3, 650 Mo chargé contre 1,2 Go ; vecteurs 768 d : 29 Mo pour 10 000 morceaux. Ollama n'occupe que
  2 cœurs sur 4 par défaut : num_thread = nombre de cœurs (ancien lot 3) donne 3,05 morceaux/s (livre en 8 min) ;
  lots de 16 sans gain, gardés à 8. Poids des mots-clés 0,5 dans la fusion (bonne page en tête 2 fois sur 5
  au lieu de 1 ; 0 ferait mieux sur le livre mais perdrait les termes exacts). Question pendant une
  indexation : 50 à 370 ms. Modèles comparés (ancien lot 3, tests/documents) : qwen3:1.7b retenu (1er mot 5 s,
  16/20) ; qwen3.5:2b plus lent (9 s, 2,7 Go), lecture du prompt moins bien mise en cache, invente en issue 2.
  RAM mesurée sur nomad pendant une question : 3,3 Go utilisés sur 7,9 (Ollama 2,6 Go avec les deux modèles).

Pages : / (liaison monde, services, recherche, stockage), /configuration, /recherche (recherche avancée puis mots-clés), /lire/<pack>/<article>
(lecteur maison), /ouvrir/<service> (cadre avec barre ODIN), /connexion.

## Disques (lot 7)

- Dossier des données : DATA_DIR de .env (relatif à /opt/odin sauf chemin absolu), lu par compose.yml, install.sh
  (fonction dossier_donnees, variable DATA) et les scripts. DONNEES=<chemin absolu> à l'installation l'écrit dans
  .env ; l'installeur refuse de changer de dossier si l'ancien contient des données (config/auth.json) et que le
  nouveau n'en a pas, et donne la marche à suivre (compose down, rsync, relancer). Dossier hors de la partition
  racine : drop-in systemd /etc/systemd/system/docker.service.d/odin-donnees.conf (RequiresMountsFor), pour que
  Docker attende le montage au démarrage (sinon il créerait des dossiers vides sur le disque système).
  DONNEES testé sur un système de fichiers monté (fichier-disque ext4 de 40 Go, fstab, VM test), PAS sur un
  disque physique distinct (Multipass 1.16/Hyper-V ne sait pas ajouter de disque).
- Place : install.sh vérifie le disque des images Docker (DockerRootDir) avant tout téléchargement : 5 Go (20 Go
  avec l'option IA, 2 Go pour une mise à jour), arrêt sinon ; avertissement sous 10 Go pour les données.
  lib/espace.mjs : chaque téléchargement (pack ZIM + 2 %, livre, carte + 5 %, modèle IA + 1 Go) réserve ce qu'il
  lui reste à écrire sur son disque (même st_dev) ; disque plein pendant l'écriture (ENOSPC) → « Disque plein ».
- Images : après chaque installation, install.sh garde par service l'image en service et la plus récente des
  autres (retour arrière possible), et retire le reste (seulement les dépôts d'ODIN).
- /var/lib/docker n'est pas déplacé par ODIN : marche à suivre dans le README (data-root).
- VM vierge (lot 7, 2026-09-23 ; test, 60 Go, fichier-disque ext4 de 40 Go monté sur /mnt/donnees par fstab,
  installation avec DONNEES=/mnt/donnees/odin) : aucun /opt/odin/data, modèle de vecteurs, fond de carte,
  materiel.json, library.xml et pack climat sur le disque de données ; Kiwix et vecteurs montés dessus ; recherche
  « effet de serre » → Effet de serre ; changement de DONNEES refusé avec la marche à suivre. Test hors ligne :
  redémarrage à froid, montage présent avant Docker, 5 conteneurs ; connexion, accueil, recherche avancée et par
  mots-clés, lecteur, /kiwix, /livres, /carte, /ia, /assistant → /ia, dépôt dans FileBrowser : OK ; Configuration
  « hors ligne » en 164 ms, boutons désactivés ; aucune requête vers un autre hôte (Chromium). Journal : seulement
  la sonde de connectivité (TCP 443 vers 1.1.1.1, 8.8.8.8, 9.9.9.9 et DNS de wikipedia.org, voulu) et le NTP
  d'Ubuntu. Coupure pendant un pack : erreur en 27 s, .part gardé, reprise après rétablissement.
  Trouvé et corrigé : download.kiwix.org renvoie vers un miroir au hasard, parfois injoignable (« fetch failed »
  d'emblée, 2 fois sur 4 premiers lancements) → 3 essais avant tout octet, cause dans les journaux ; erreurs
  d'hydratation React 418 (extrait Kiwix coupé dans un <b>, date formatée côté serveur) → balises équilibrées,
  app/DateLocale.jsx.

## Règles

- Rien en dur : ni IP, ni ports, ni noms de fichiers. Configuration dans .env, modèle dans .env.exemple.
- Tout doit fonctionner hors ligne à l'exécution : voir « Principe hors ligne ».
- Ne jamais modifier ni supprimer data/ sur nomad : ZIM, documents et mot de passe y vivent.
- Ne jamais committer data/ ni .env.
- Fins de ligne Linux obligatoires (.gitattributes) : les scripts bash cassent avec des fins de ligne Windows.
- Style : thème années 90 (angles vifs, biseaux --biseau, reliefs --relief/--creux, police --mono),
  accent or --or. Le bloc du thème est délimité dans dashboard/app/globals.css.
- Livres Hesperian (docs/conception-packs-documents.md, section 10), jusqu'à nouvel ordre du propriétaire :
  ne jamais publier la release GitHub livres-v1, et ne jamais fusionner dans main ce qui installe un livre
  Hesperian, tant que le propriétaire n'a pas reçu l'accord écrit d'Hesperian (usage numérique).
  Les tests sur nomad (branche dev) sont autorisés.

## Pièges déjà rencontrés

- kiwix-serve ajoute déjà --port=8080 ; tourne en UID 1001 ; boucle si library.xml est absent.
- Next standalone ne copie pas public/ : le Dockerfile doit le faire.
- download.kiwix.org exige curl -L ; catalogue OPDS : library.kiwix.org/catalog/v2/entries.
- Le build arm64 émulé bloque GitHub Actions.
- raw.githubusercontent.com garde un cache jusqu'à 5 minutes : tester avec l'identifiant du commit.
- Ollama interroge ollama.com au démarrage puis toutes les 4 h (recommandations, cache cloud) :
  OLLAMA_NO_CLOUD=true le coupe, les ollama pull restent possibles.
- FileBrowser Quantum interroge api.github.com au démarrage (version) : server.disableUpdateCheck: true.
- Au démarrage de la machine, Docker relance tous les conteneurs ensemble et ignore depends_on :
  tout code qui dépend d'un autre service (le dashboard envers Ollama) l'attend lui-même.
- État partagé du dashboard (sonde, tâches, réglages) : toujours dans globalThis, car instrumentation.js
  et les routes sont des bundles séparés qui chargeraient chacun leur copie des modules.
- Pour trouver qui appelle internet : tcpdump -i any udp port 53 sur l'hôte, en redémarrant un service à la fois.
- Mise à jour (install.sh relancé) : git remplace compose.yml, Caddyfile et config/, seul .env est gardé.
  Un fichier monté seul (Caddyfile, filebrowser.yaml) reste sur l'ancienne version dans le conteneur, et
  up -d ne recrée que les services dont compose.yml a changé : install.sh compare l'ancien et le nouveau
  commit et redémarre caddy ou filebrowser si leurs fichiers ont changé. Tout nouveau fichier
  monté doit être ajouté à cette liste.
- install.sh tourne en root sur /opt/odin appartenant à l'utilisateur : git exige safe.directory
  (fonction depot dans install.sh).
- VM renommée par l'installeur : Windows garde l'ancienne adresse dans hosts.ics et Multipass reste
  bloqué. D'où NOM_HOTE=test pour les VM de test.
- MapLibre 6 déduit l'adresse de son worker de import.meta.url : regroupé par webpack, il la perd. Il est
  donc copié tel quel dans public/ (scripts/ressources-carte.mjs, prebuild) et importé avec webpackIgnore.
- MapLibre 6 dessine lui-même l'arabe et l'hébreu ; le module RTL est obsolète et remplacerait ce rendu.
- pmtiles extract réserve la taille finale du fichier dès le début : la progression se lit dans sa
  sortie (« NN% | »), pas dans la taille du .part. Une extraction interrompue repart de zéro.
- fetch de Node 24 (undici) vers kiwix-serve (Connection: close, gros articles) : plantage sur
  assert(!this.paused) dans Parser.finish, qui arrête le fil. L'assistant lit Kiwix avec le module http
  (assistant/http.mjs). lib/recherche.mjs et lib/lecture.mjs utilisent encore fetch vers Kiwix.
- Cœurs (vérifié au lot 7, nomad 4 cœurs) : vecteurs à ~380 % pendant l'indexation (-t nproc) ; deux lots en
  parallèle ne vont pas plus vite (calcul saturé). pdftotext : un cœur par fichier, mais 1,9 s pour 639 pages,
  négligeable devant les vecteurs. Kiwix : 4 fils par défaut. Ollama : num_thread = cœurs. Aucun autre piège.
- multipass exec ne transmet pas l'entrée standard (un « cat > fichier » ou un « docker exec -i … < - » par un
  tube attend sans fin) : passer les fichiers par multipass transfer, puis docker cp ou une redirection sur la VM.
- llama.cpp server prend par défaut la moitié des cœurs : -t $(nproc) dans le point d'entrée du service vecteurs.
- Hors ligne, chaque résolution DNS bloque un fil libuv plusieurs secondes et les lectures de fichiers
  attendent derrière : UV_THREADPOOL_SIZE=16 dans l'image du dashboard.

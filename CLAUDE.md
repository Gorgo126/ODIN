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
Le serveur de test est la VM Multipass "odintest" (Ubuntu 24.04, 192.168.129.35), où le dépôt est
cloné dans /opt/odin. Ne jamais y modifier de fichier directement : il ne fait que git pull.
odintest a été créée neuve le 2026-09-25 et installée depuis main (2cf0c62, NOM_HOTE=odintest) : pour la faire
suivre dev, relancer l'installeur avec BRANCHE=dev. L'ancienne VM de test « nomad » (192.168.129.19) est gardée
arrêtée, remise à son snapshot « vierge » ; ses snapshots (dont avant-reinstallation = son état complet avant la
réinstallation, avec packs, documents et mot de passe) y restent. Multipass ne sait pas renommer une VM, et un clone
garde l'ancien nom d'hôte : Multipass le cherche alors sous <nouveau nom>.mshome.net et reste bloqué au démarrage.

- On travaille sur la branche dev. odintest suit dev.
- Pour tester : commit et push sur dev, puis
  multipass exec odintest -- bash -lc "cd /opt/odin && git pull --ff-only origin dev && docker compose -f compose.yml -f compose.dev.yml up -d --build --remove-orphans"
  (--remove-orphans retire les conteneurs d'un service supprimé de compose.yml ; install.sh fait de même)
  « origin dev » explicite : l'installeur crée la branche sans suivi (pas de --track), un git pull seul tenterait de fusionner main.
  Si le .env de odintest porte COMPOSE_FILE (option IA, simulée sur odintest depuis le lot 5), les -f l'ignorent
  et --remove-orphans supprimerait Ollama : ajouter -f compose.ia.yml avant -f compose.dev.yml.
  Revenir sans IA sur odintest : relancer l'installeur sans ODIN_SIMULER_VRAM (il retire la ligne COMPOSE_FILE).
- Le propriétaire vérifie dans son navigateur sur http://192.168.129.35
- Une fois validé : fusionner dev dans main et pousser. C'est main que récupère l'installeur.
- Image du dashboard : à chaque push sur main ou dev touchant dashboard/, GitHub Actions publie
  ghcr.io/gorgo126/odin-dashboard:<sha> puis fige le compose.yml de cette branche sur cette image, par
  un commit automatique (github-actions[bot]). Faire git pull avant de repousser. L'installeur prend
  donc l'image de la branche clonée (BRANCHE). Suivre un build : gh run list / gh run watch.
- Revenir sur odintest à l'image publiée : ... && docker compose pull dashboard && docker compose up -d --remove-orphans
- Logs : multipass exec odintest -- bash -lc "cd /opt/odin && docker compose logs --tail 50 <service>"
- Tester une route interne sans authentification :
  multipass exec odintest -- docker exec caddy wget -qO- http://dashboard:3000/...

Avant une modification importante, proposer un snapshot :
multipass stop odintest && multipass snapshot odintest --name <nom> && multipass start odintest
Ne jamais restaurer ni supprimer une VM sans l'accord explicite du propriétaire.

Toute modification de install.sh doit être validée sur une VM vierge :
multipass launch 24.04 --name test --cpus 4 --memory 8G --disk 40G --network Ethernet
puis curl de install.sh depuis raw.githubusercontent.com/Gorgo126/ODIN/<commit>/install.sh et
sudo BRANCHE=dev bash (défaut : main ; la variable se place après sudo, sinon sudo l'efface) :
multipass exec test -- bash -lc "curl -fsSL https://raw.githubusercontent.com/Gorgo126/ODIN/<commit>/install.sh | sudo BRANCHE=dev NOM_HOTE=test bash"
NOM_HOTE=test est obligatoire sur une VM vierge : sinon la VM se renomme "odin" et, au redémarrage, Multipass ne la
joint plus (il la cherche sous test.mshome.net). Arrêter/démarrer la VM : multipass stop test / start test.
Supprimer ensuite la VM de test (multipass delete test --purge), jamais odintest.
Recherche avancée et option IA : VM vierge et test hors ligne faits au lot 7 (2026-09-23), voir « Disques ».
La VM vierge installe l'image publiée pour la branche : après un push touchant le dashboard,
attendre le commit automatique de GitHub Actions et installer depuis ce commit.
Mémoire : odintest et test (8 Go chacune) ne tiennent pas ensemble ; arrêter odintest pendant le test.

### Test hors ligne

Sur une VM test, jamais sur odintest (il modifie le pare-feu du système). Coupe internet mais garde
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
  Dépendances transitives figées par dashboard/package-lock.json (npm ci au build) ; poppler-utils figé à la version
  exacte d'Alpine (=25.12.0-r0) : si Alpine la retire, le build échoue au lieu de changer en silence.
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
- libretranslate : traduction hors ligne (libretranslate/libretranslate:v1.9.6, CPU, modèles Argos). Réseau Docker
  « traduction » en internal: true, partagé avec le dashboard seul : aucun port publié, absent de Caddy, et aucune
  route vers internet. Modèles dans ${DATA_DIR}/traduction (packages/, minisbd/), en lecture seule pour lui
  (/home/libretranslate/.local/share/argos-translate, UID 1032), en écriture pour le dashboard (/traduction).
  Vérifié : ni Argos ni LibreTranslate n'y écrivent (index.json et verrous MiniSBD seulement pour un téléchargement).
  LT_DISABLE_WEB_UI, LT_DISABLE_FILES_TRANSLATION, LT_API_KEYS=false, LT_UPDATE_MODELS=false, LT_THREADS=1 (chaque
  processus charge sa copie des modèles), LT_CHAR_LIMIT = TRADUCTION_LIMITE (même limite dans la route du dashboard).
  Healthcheck Python sur /languages (pas de curl dans l'image) ; carte d'accueil et page font le même test.
  LibreTranslate sert les modèles présents sur le disque ; LT_LOAD_ONLY ne servirait qu'à un téléchargement. Avec
  moins de 2 modèles, il tenterait de tout télécharger : install.sh démarre donc le dashboard seul, lui fait installer
  fr et en, et seulement ensuite le reste.
  Packs de langues (lib/traduction-packs.mjs, catalogue/traduction.json : 49 langues de l'index Argos, xx→en et
  en→xx, modèle MiniSBD utilisé, code de l'API quand il diffère : pb → pt-BR, zh → zh-Hans, zt → zh-Hant). Base fr et
  en, jamais désinstallables. Le dashboard télécharge (reprise, 30 s d'inactivité, 3 essais avant le premier octet),
  vérifie l'empreinte, décompresse (unzip de BusyBox) dans .en-cours/ du même volume, écrit odin-sha256 (un modèle
  installé est reconnu par l'empreinte de son archive, pas par son dossier), rend lisible par tous (chmod), puis
  renomme d'un coup dans packages/. .en-cours/ est vidé au démarrage du dashboard, et une langue à moitié présente
  est retirée : une installation interrompue ne laisse rien. Un modèle MiniSBD partagé (tr.onnx : tr et az) reste
  tant qu'une langue installée s'en sert.
  Rechargement sans socket Docker, sur le modèle de Kiwix (qui relit library.xml, --monitorLibrary) : le dashboard
  écrit .recharger, une fois après la dernière de plusieurs opérations simultanées ; le point d'entrée du service
  (compose.yml) le lit toutes les 2 s et arrête proprement le processus serveur (SIGTERM au worker gunicorn) ; le maître
  en relance un aussitôt, qui relit les modèles (1 à 2 s, le port reste ouvert : une requête attend). Pas de HUP (voir
  Pièges). Processus trouvés dans /proc (enfants gunicorn du script d'entrée), sans fichier pid. Ce point d'entrée
  transmet SIGTERM à gunicorn (docker stop immédiat) et se termine avec lui (restart: unless-stopped le relance).
  /api/traduction/languages rend { langues, rechargement } : « Rechargement des langues… » sur /traduction tant
  que LibreTranslate ne sert pas les langues installées (60 s au plus), jamais une erreur.
  TRADUCTION_LANGUES (.env, défaut fr,en) : langues de la première installation seulement (aucun modèle présent) ;
  ensuite le disque fait foi, install.sh ne garantit que fr et en, une langue désinstallée ne revient jamais seule.
  Toutes les paires passent par l'anglais (pivot automatique d'Argos : fr→de = fr→en→de, moins précis).
  Vérifié sur odintest (2026-09-25) : relecture des modèles en 1,5 à 2,7 s, 23 traductions envoyées pendant ce temps,
  0 échec, conteneur non redémarré ; un seul signal pour 5 installations simultanées ; docker stop en 2,2 s ; kill -9
  du maître → conteneur relancé ; dashboard redémarré en cours d'installation → rien sur le disque, langue absente ;
  empreinte fausse → refus, rien d'installé ; redémarrage à froid avec fr et en seuls ; aucune écriture de
  LibreTranslate dans le dossier des modèles. RAM : 119 Mo au repos, 1,08 Go avec 7 langues sources chargées ; pas
  de pic au rechargement (l'ancien processus s'arrête avant que le nouveau charge ses modèles, à la demande).
  Dashboard : lib/traduction.mjs, /api/traduction/{languages,detect,translate}, /api/traduction/packs[/<code>],
  page /traduction (lien « Ajouter des langues » vers /configuration#traduction), panneau Traduction.
  Ajouter une langue au catalogue : ses modèles xx→en et en→xx de l'index argospm-index, empreinte et taille calculées
  sur les fichiers, son modèle MiniSBD (même correspondance que MiniSBDSentencizer d'Argos, anglais à défaut), son nom
  français ; puis tester une traduction depuis cette langue hors ligne.
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

- socket-proxy : wollomatic/socket-proxy:1.13.1 figé par tag ET digest (sha256:3935b709…7002, index multi-arch),
  pour /sante. Choisi plutôt que tecnativa/docker-socket-proxy parce qu'il filtre par expression régulière : seuls
  GET /containers/json et GET /info passent (-allowGET, ^…$ ajoutés par l'outil). Avec tecnativa, CONTAINERS=1
  ouvrirait aussi l'inspection (variables d'environnement) et les journaux. -allowfrom=dashboard : filtre sur le nom
  d'hôte, un autre conteneur du réseau reçoit 403. Réseau « sante » en internal: true, partagé avec le dashboard
  seul ; aucun port, absent de Caddy. Socket monté en :ro, ce qui n'empêche AUCUNE requête (connect() n'écrit pas
  le fichier) : seule la liste blanche protège. user 0:0 sans aucune capacité (cap_drop ALL, read_only,
  no-new-privileges) : le socket appartient à root et le groupe docker n'a pas le même numéro partout.
  Vérifié sur odintest (2026-09-25) : inspection, logs, top, /images, /version → 403 ; POST stop/restart, DELETE → 405 ;
  chemins détournés (../, %2F) → 403 ; conteneur tiers sur le réseau → 403.
- État du serveur (lib/sante.mjs, /api/sante, page /sante, bandeau app/BandeauSante.jsx en bas de l'accueil, 30 s ;
  page 10 s). RAM, charge, uptime lus dans /proc du conteneur : Docker ne les virtualise pas, ce sont ceux de l'hôte
  (vérifié : mêmes valeurs que la VM). Disque : statfs('/data'), comme la jauge. Conteneurs du projet Compose du
  dashboard (label com.docker.compose.project de son propre conteneur, trouvé par son hostname). /containers/json
  n'a NI nombre de redémarrages NI date de démarrage (seulement dans l'inspection, refusée) : « Depuis » vient du
  texte Status (« Up 3 hours »), et les redémarrages ne sont pas affichés. Santé : champ Health (API Docker ≥ 1.52),
  sinon le texte Status ; ignorée pour un conteneur arrêté (Docker garde le dernier résultat). Image affichée
  « image remplacée depuis le démarrage » quand le tag pointe maintenant vers une autre image (cas de caddy sur odintest
  le 2026-09-25 : conteneur sur de23def33b17 = caddy:2-alpine, alors que caddy:2.11.4-alpine est une autre image).
  Niveau : rouge si disque > 95 %, conteneur arrêté, en redémarrage ou unhealthy ; orange si disque > 85 % ou relais
  injoignable (délai 2 s : la page s'affiche avec « état des conteneurs indisponible »). Seuils du disque 85/95
  partout (niveauDisque de lib/format.mjs, jauge de l'accueil comprise). Lectures partagées 2 s entre les clients.
  Version : data/config/version ({commit, branche, installe}), écrit par CHAQUE passage de install.sh après le clone ;
  un git pull seul (odintest) ne le met pas à jour : la version affichée est celle du dernier passage de l'installeur,
  « Inconnu » sur une installation antérieure. L'image du dashboard (tag = commit) est affichée à côté.
  Espace par contenu (lib/espace-contenus.mjs, état dans lib/espace-cache.mjs, /api/sante/espace ; POST = recalculer) :
  calcul en arrière-plan, jamais attendu par une requête, un seul à la fois (relancé une fois s'il a été invalidé
  pendant), gardé 10 min, invalidé à la fin de chaque téléchargement (fini, échoué, annulé) et à chaque suppression.
  Taille en blocs (comme statfs), liens symboliques jamais suivis (Mes documents). Fichiers partiels listés « en
  cours ». « Autre / système » = disque utilisé moins les catégories. Modèles Ollama seulement avec OLLAMA_URL.
  Mes documents n'est pas surveillé : 10 min ou « Recalculer ».
- Suppressions : une seule définition (lib/suppressions.mjs : route, méthode, confirmation, éléments non retirables :
  fond de carte, fr et en), utilisée par Configuration (Packs, Livres, PacksCartes, PacksTraduction, InstallationIA) et
  /sante ; le serveur la joint aux éléments de /api/sante/espace. Aucune route de suppression propre à /sante.
- Désinstallation des ZIM (DELETE /api/packs/<id> : annule un téléchargement en cours, sinon désinstalle, comme
  livres et cartes). Fichiers du pack = son nom ET sa variante (fichiersPack : deux packs partagent
  wikipedia_fr_all). Livres retirés de library.xml d'abord (même verrou que l'inscription), puis fichiers, puis taille
  mémorisée (tailles.json, réécrite à la prochaine lecture du catalogue en ligne). Un téléchargement du même pack en
  cours est annulé et attendu d'abord. L'assistant relit le catalogue Kiwix dès que la date de library.xml change
  (assistant/wikis.mjs). Un ZIM hors catalogue ou d'une autre variante que celle du catalogue (medecine nopic sur
  odintest) n'est pas désinstallable depuis ODIN.

- « Comment faire ? » (2026-09-26) : articles du blog d'odin-node.com, installés à la demande, lisibles et cherchables hors
  ligne. Source : https://odin-node.com/odin/guides/manifest.json (no-cache ; GUIDES_MANIFESTE pour en changer, sans passer
  par compose.yml). Contrat format 1 : manifeste publié {format, version, generated_at, archive {url, sha256, size},
  categories[] {slug, title, description, order}, articles[] {slug, title, category, summary, published, updated, sha256}} ;
  tout autre format refusé (« une mise à jour d'ODIN est nécessaire »). Archive tar.gz : manifest.json (= manifeste publié
  SANS « archive », comparé clé par clé), articles/<slug>.html (fragments sans h1), assets/<slug>/* (SVG autonomes, fond
  sombre et couleurs en dur). Changements détectés par le sha256 des articles SEULEMENT (contrat) : même version, autre
  sha256 = modifié. Archive acceptée seulement en https sur le même site que le manifeste.
  lib/guides.mjs (installation, vérification, suppression), lib/guides-index.mjs (lecture, sans dépendance : pages,
  recherche, worker), lib/guides-html.mjs (nettoyage), lib/tar.mjs (lecteur ustar en mémoire), lib/recherche-guides.mjs,
  assistant/source-guides.mjs, /api/guides (GET état, POST {action: verifier|installer}, DELETE), /api/guides/assets/
  <slug>/<fichier> (nom de fichier du contrat, article installé, pas de lien, chemin résolu resté dans le dossier ;
  image/svg+xml, nosniff, CSP sandbox), pages /comment-faire, /comment-faire/<catégorie>, /comment-faire/<catégorie>/<slug>
  (Lecteur de /lire, sans lien Kiwix, classe guide), carte de l'accueil (« Non installé » tant que rien n'est là), panneau
  Configuration id="guides" (seul endroit avec « Supprimer les articles », définition dans lib/suppressions.mjs), catégorie
  de /sante.
  Stockage : data/config/guides (volume /config existant : ni compose.yml ni install.sh modifiés). Chaque version dans
  v-<date>-<hasard>/ (manifest.json publié complet, guides.json = index construit à l'installation : HTML nettoyé et texte par
  section h2, articles/, assets/) ; le lien « actuel » est basculé par un rename, puis les anciennes versions retirées. Tout
  échec avant la bascule laisse la version installée intacte. 604 Ko pour 12 articles et 19 schémas (archive de 68 Ko).
  Installation : enLigne() d'abord (sinon « Connexion à internet nécessaire pour installer ou mettre à jour », tout de
  suite) ; manifeste 10 s au plus ; archive par telechargerFlux (15 s pour la réponse, 30 s d'inactivité, taille annoncée
  = maximum), SHA-256, puis lecture en mémoire et contrôle AVANT toute écriture : entrées ustar ordinaires seulement (lien,
  pax, périphérique refusés), aucun « .. », chemin absolu ni antislash, uniquement manifest.json, les articles du manifeste
  et leurs assets, tous les articles présents, toute image appelée présente, aucun doublon. Archive en 404 ou empreinte
  fausse : manifeste relu une fois et nouvel essai, puis erreur. Une installation à la fois ; suppression refusée pendant.
  Nettoyage (liste blanche) : h2-h4, p, ul, ol, li, blockquote, pre, code, table, figure, figcaption, img, a, strong, em,
  PLUS thead, tbody, tfoot, tr, th, td (le contrat dit « table » ; les articles réels en ont besoin). Attributs : a href/title,
  img src/alt/width/height, th/td colspan/rowspan/scope, ol start ; tout le reste retiré (on*, style, class). script, style,
  iframe, svg… retirés avec leur contenu, autres balises inconnues retirées en gardant le texte. Liens javascript:, data:,
  vbscript: (même masqués par des espaces ou des entités) retirés ; https://odin-node.com/blog/…/<slug> → article local s'il
  est installé ; autres liens : target _blank, data-externe, « ↗ nécessite internet » (CSS), grisés hors ligne par le
  Lecteur. Images : seulement assets/<son slug>/<fichier présent>. Un bloc ferme un paragraphe ouvert (comme le parseur HTML) ;
  balises refermées en fin de fragment. Ce qui est retiré est écrit dans les journaux du dashboard.
  Schémas : pas de fond blanc (la règle .article img des articles Kiwix est annulée pour .guide), marge seulement. Leurs
  titres demandent la police VT323 (et IBM Plex Mono) : un SVG chargé par <img> ne peut charger aucune police, et ODIN n'en
  embarque aucune, donc ils s'affichent en monospace du système (vu dans Chromium). Même comportement que sur le site si
  celui-ci les charge aussi par <img>.
  Recherche : bloc « Comment faire ? » au-dessus de la bibliothèque sur /recherche (mots-clés, une ligne par article, meilleure
  section) ; source « guides » de la recherche avancée et de l'assistant (origine comment-faire, étiquette « Comment faire ? »,
  paragraphes des 5 sections les plus riches en mots de la requête, 4 vectorisés ; articles de la catégorie sante = guide
  médical pour les urgences). Seuils guides = ceux des livres (0,45 / 0,3), NON CALIBRÉS. Index relu quand la version change :
  installation, mise à jour et suppression visibles à la question suivante (vérifié : trouvé → supprimé, rien → réinstallé,
  trouvé).
  Tests : node --test tests/guides.test.mjs (9 : nettoyage, liens, images, archive conforme et 10 archives refusées, format 2,
  différences). Vérifié le 2026-09-26 sur odintest (dev 8f2afab à b070cdf) : installation depuis zéro (< 1 s), 12 articles et
  19 schémas, sirènes et eau potable lus avec schémas, aucune requête vers un autre hôte, aucune erreur de console, aucun
  débord à 390 px ; manifeste local modifié à la main (un article en moins, un sha256 changé) → « Nouveaux (1) », « Modifiés
  (1) », mise à jour en 1,5 s, puis « à jour » ; dashboard coupé d'internet (docker network disconnect, jamais le pare-feu
  sur odintest) : sonde encore « établie » → échec en 5 s (DNS), sonde « rompue » → refus en 46 ms, articles et schémas
  lisibles ; suppression puis réinstallation depuis l'interface (1,3 s). Contre un site simulé (fetch remplacé,
  GUIDES_DOSSIER) : empreinte fausse → manifeste relu → installé ; 404 deux fois → erreur, version intacte ; archive à la
  bonne empreinte mais avec articles/../../x → refusée, rien écrit ; format 2 → refusé. Test hors ligne sur VM test (dev
  9dc6ccd, installée en 158 s) : articles installés, hors-ligne.sh couper, redémarrage à froid, 7 conteneurs ; accueil,
  /comment-faire, catégorie, deux articles avec schémas, recherche, Configuration sans requête vers un autre hôte ; boutons
  grisés avec le message, « Supprimer » actif ; API : refus en 15 ms ; journal : sonde et NTP seulement, capture DNS de
  90 s pendant l'usage des articles : wikipedia.org (sonde) seulement.
  NON VÉRIFIÉ : coupure au milieu du téléchargement (archive de 68 Ko, reçue d'un coup) ; réécriture des liens du blog sur
  de vrais articles (les 12 articles actuels n'ont AUCUN lien : testée seulement par les tests unitaires) ; empreinte de
  chaque article (formule non publiée : seule l'archive est vérifiée) ; seuils de la recherche avancée pour ces articles.
- Point d'accès Wi-Fi (option POINT_ACCES, NON VÉRIFIÉE sur du vrai matériel ; brief docs/conception-point-acces.md,
  lots 1 et 2 (portail captif) faits et dans main depuis le 2026-09-26, lot 3 bascule seulement sur accord du propriétaire). Sur l'hôte, jamais dans un conteneur : hostapd et dnsmasq
  (paquet dnsmasq-base, PAS dnsmasq qui lance un service sur le port 53) sous systemd. scripts/point-acces.sh
  (detecter, installer, desinstaller, etat ; demarrer, arreter, echec pour les unités ; fonctions chargeables par
  les tests), modèles dans config/point-acces/, fichiers générés dans /etc/odin/point-acces/ (root, 600 : parametres,
  hostapd.conf avec @CANAL@, dnsmasq.conf, mot-de-passe), hostapd.conf du démarrage dans /run/odin-point-acces/.
  Les unités ne lisent jamais .env : parametres fige interface, plage, SSID, pays et DATA à l'installation.
  Unités : odin-point-acces.target (WantedBy multi-user, DefaultDependencies=no + Conflicts/Before=shutdown.target
  remis à la main : la target est atteinte sans attendre ses services, donc multi-user.target non plus),
  odin-point-acces-reseau.service (oneshot, After=docker.service, TimeoutStartSec=30, scan de 8 s au plus :
  rfkill, NetworkManager, canal, adresse, IPv6 coupé sur l'interface seule, pare-feu ; son arrêt défait tout),
  odin-hostapd et odin-dnsmasq (BindsTo le réseau, Restart=on-failure, 5 essais en 2 min), odin-point-acces-echec
  (OnFailure= des trois : état echec-demarrage). hostapd.service de la distribution masqué.
  Détection : iw dev (interface imposée par POINT_ACCES_INTERFACE sinon la première libre avec « * AP » dans
  Supported interface modes), occupée si route par défaut, adresse autre que la nôtre ou « Connected to » ;
  une installation existante garde son interface tant qu'elle existe (sinon une autre carte serait prise et
  l'ancienne adresse ferait croire la plage occupée : vu au test). Pays : PAYS, sinon fuseau → zone.tab, sinon 00
  (pas de country_code dans hostapd.conf alors). Canal : scan, groupe le moins chargé parmi 1/6/11, 6 à égalité ou
  en échec. Raisons : aucune-carte, pas-de-mode-ap, wifi-occupe, echec-demarrage, plage-occupee.
  Pare-feu (Docker 29.8.1 : backend iptables, via iptables-nft) : iptables et ip6tables
  -I DOCKER-USER -i <if> -m conntrack ! --ctstate DNAT -j DROP (FORWARD si la chaîne n'existe pas), posée par le
  démarrage sans doublon (-C), retirée par l'arrêt. Jamais forwarding=0 sur l'interface : l'accès à Caddy passe par
  le DNAT de Docker. Politique FORWARD de Docker déjà DROP, la règle est une garantie de plus.
  dnsmasq : interface=<if>, except-interface=lo (sinon il écoute aussi 127.0.0.1 et ::1), bind-interfaces, no-resolv,
  no-hosts, host-record <nom>,<nom>.lan, address=/#/<ip>, local=/#/ (AAAA : réponse vide ; sans lui REFUSED, faute de
  serveur amont ; filter-AAAA n'y change rien), baux dans /run/odin-point-acces/.
  NetworkManager : /etc/NetworkManager/conf.d/odin-point-acces.conf avec une section [device-odin-point-acces]
  match-device=interface-name:<if> et managed=0, plus nmcli device set managed no/yes. PAS keyfile.unmanaged-devices :
  la liste d'Ubuntu contient « except:type:wifi », et une exclusion except: l'emporte sur toute la liste, donc
  « += interface-name:<if> » ne rend jamais une carte Wi-Fi non gérée (--print-config l'affiche pourtant) ;
  « = » donnerait l'Ethernet et les ponts Docker à NM. La déclaration reste tant que l'option est installée (seul
  desinstaller la retire) : retirée à chaque arrêt, NM prenait la carte au démarrage suivant pendant ~10 s, assez
  pour rejoindre un réseau Wi-Fi enregistré (vu au lot 2 : journal de NM, « unmanaged -> unavailable »).
  État : ${DATA}/config/point-acces.json (etat actif|inactif|indisponible, raison, interface, ssid, motDePasse, adresse,
  noms [<nom>.lan, <nom>.local si avahi], canal, pays, maj), 640 au propriétaire de data/config : le conteneur
  dashboard tourne en root (vérifié le 2026-09-25) et le lira au lot 2 ; à revoir si l'image passe en non-root.
  QR codes point-acces-wifi.svg et point-acces-adresse.svg (qrencode) à côté. « actif » écrit par ExecStartPost de
  hostapd et dnsmasq quand les deux tournent et que la carte est en mode AP ; un service dans son ExecStartPost n'est
  pas « active » : attendre « active » faisait s'attendre les deux (10 s perdues, état jamais écrit au démarrage).
  install.sh (« Point d'accès Wi-Fi », avant « Terminé ») : POINT_ACCES après sudo, sinon celui de .env (gardé),
  paquets iw hostapd dnsmasq-base qrencode rfkill, puis installer ; 0 sur une machine où l'option était active :
  desinstaller (unités, /etc/odin/point-acces, règles, déclaration NM, adresse ; état inactif). Une mise à jour
  régénère les fichiers et ne redémarre que si l'un d'eux change (comparaison des fichiers générés). Le mot de passe
  (xxxx-xxxx-xxxx sans 0/o/1/l) est gardé aux mises à jour, perdu par POINT_ACCES=0.
  Tests A : bash tests/point-acces/lancer.sh (25 cas, faux iw/ip/timedatectl dans tests/point-acces/faux).
  Tests B : sudo scripts/point-acces-test.sh preparer|connecter|verifier|nettoyer, sur une VM test SEULEMENT
  (mac80211_hwsim de linux-modules-extra-$(uname -r), 3 radios : wlan0 ODIN, wlan1 dans l'espace de noms
  « telephone » avec wpa_supplicant et udhcpc de busybox, wlan2 dans « box » pour le lot 3 ; hwsim chargé au
  démarrage par /etc/modules-load.d pour le test). Les espaces de noms ne survivent pas au redémarrage : preparer.
  Portail captif (lot 2) : Caddyfile, bloc en tête de :80 : remote_ip {$PORTAIL_RESEAU} et Host absent de
  {$PORTAIL_HOTES} → rewrite /api/portail/sonde, chemin d'origine dans X-Odin-Chemin, Host gardé. Caddy voit la vraie
  IP du client (vérifié par capture sur le pont Docker : source 10.42.0.42, X-Forwarded-For: 10.42.0.42 ; le port
  publié passe par le DNAT de Docker). Une variable à espaces ({$PORTAIL_HOTES}) donne bien plusieurs hôtes (caddy
  adapt). compose.yml : PORTAIL_RESEAU=${PORTAIL_RESEAU:-192.0.2.0/32} (plage de documentation, ne correspond à rien)
  et PORTAIL_HOTES=${PORTAIL_HOTES:-portail.invalid} pour caddy, PORTAIL_RESEAU pour le dashboard. install.sh les
  écrit dans .env dès que POINT_ACCES=1 et la plage valide et libre (point-acces.sh portail), QUEL QUE SOIT l'état du
  point d'accès (un échec passager de hostapd ne doit pas priver la machine de portail, et le lot 3 basculera sans
  install.sh) ; retirés seulement par POINT_ACCES=0 ; docker compose up -d si elles changent. Hôtes exclus :
  <adresse>, <nom>, <nom>.lan, <nom>.local (avahi).
  Dashboard : lib/portail.mjs = LA table des sondes (SONDES) et les appareils libérés (IP → 12 h, globalThis, perdus
  au redémarrage du dashboard : le portail revient, accepté). /api/portail/sonde (GET, HEAD, POST) : non libéré → 302
  http://<adresse>/portail ; libéré et sonde connue → réponse exacte + X-NetworkManager-Status: online ; sinon → 302
  http://<adresse>/. /api/portail/liberer : formulaire HTML (pas de JavaScript ni de cookie), 303 vers
  /portail?libre=1, 403 hors de PORTAIL_RESEAU. /portail public (Caddy @public : /portail, /api/portail/*), consigne
  Android visible par tous après « Continuer ». /point-acces/fiche (protégée, imprimable) et /api/point-acces/qr/{wifi,
  adresse} (SVG en <img>, CSP sandbox). Panneau « Point d'accès Wi-Fi » de Configuration. Le dashboard n'écrit rien.
  dnsmasq : dns.msftncsi.com → 131.107.255.255 (sonde DNS de Windows 10).
  Sondes (réponses vérifiées le 2026-09-25 dans les sources, et identiques aux serveurs réels) :
  Android (AOSP NetworkStack, config.xml, CaptivePortalProbeResult, NetworkMonitor) : connectivitycheck.gstatic.com,
  www.google.com, play.googleapis.com, clients3/clients1.google.com, connectivitycheck.android.com, /generate_204 et
  /gen_204 → 204 vide ; un 302 = portail (redirections non suivies). Apple (Apple Support « Use Apple products on
  enterprise networks » ; aucune règle publiée) : captive.apple.com, tout chemin → 200 text/html, page Success de 69
  octets (\n final) ; www.apple.com/library/test/success.html → même page, 68 octets ; anciens hôtes
  (appleiphonecell.com, itools.info, ibook.info, airport.us, thinkdifferent.us) : SOURCES SECONDAIRES seulement.
  Windows (Microsoft Learn, NCSI) : www.msftconnecttest.com et ipv6.msftconnecttest.com /connecttest.txt → 200
  « Microsoft Connect Test » ; www.msftncsi.com/ncsi.txt → « Microsoft NCSI » ; Windows 11 et le Wi-Fi décident par
  HTTP. Firefox (all.js, CaptiveDetect.sys.mjs ; domaine changé le 2026-08-10) : firefox-portal-detection.com
  /generate_204 → 204 vide, /success.txt → « success\n » ; ESR 140 : detectportal.firefox.com/canonical.html → le
  meta refresh exact (90 octets), /success.txt. NetworkManager (nm-connectivity.c : l'en-tête X-NetworkManager-Status:
  online suffit ; sinon corps comparé sur son début) : connectivity-check.ubuntu.com. (avec le point final : Host
  normalisé), nmcheck.gnome.org, ping.archlinux.org, fedoraproject.org/static/hotspot.txt.
  Tests du lot 2 : node --test tests/portail.test.mjs (6 : réponses et tailles exactes, hôtes, libération, plage) ;
  sudo scripts/point-acces-test.sh portail (B6, rejouable : redémarre d'abord le dashboard, qui oublie les appareils
  libérés ; 33 contrôles : 14 sondes → 302 /portail, /portail 200, Continuer 303,
  14 sondes → réponse identique à l'octet, autre domaine → 302 /, dns.msftncsi.com, ODIN par son adresse sans portail).
  Résultats lot 2 (VM test, 2026-09-25/26) : B6 33/33 ; depuis le PC par l'IP Ethernet, Host de sonde → 302 /connexion
  (aucun portail), liberer → 403, fiche et QR → connexion. B10 : hors-ligne.sh couper, redémarrage à froid, point
  d'accès revenu seul, B1 à B6 bons, pages (accueil, recherche, lecteur, /kiwix, Documents, livres, carte, traduction,
  santé, /portail, /portail?libre=1, fiche) sans requête vers un autre hôte ni erreur de console, Configuration « hors
  ligne » en 156 ms, dépôt dans FileBrowser ; journal : sonde du dashboard (TCP 443 et DNS de wikipedia.org), NTP,
  et les tentatives volontaires des tests (téléphone et VM vers 1.1.1.1) : aucune ligne due à l'option. Redémarrages
  à froid avec NetworkManager : réseau et portail revenus, carte « unmanaged » dès le démarrage (après correction),
  multi-user.target à 14 s, hostapd cassé → echec-demarrage et ODIN complet. Tests A et B du lot 1 relancés : bons.
  VM vierge (dev 605589c) : POINT_ACCES=1 sans carte → indisponible, portail activé quand même, 165 s ; radios et
  relance → B1 à B6 bons. Pack climat de B10 téléchargé par curl sur la VM (IPv6) puis inscrit par ODIN : le miroir
  Kiwix ne répondait qu'en IPv6.
  Résultats (VM test, 2026-09-25, Ubuntu 24.04, noyau 6.8.0-139, Docker 29.8.1) : A 25/25. B 1 à 5 : actif, JSON et
  QR, mauvais mot de passe refusé, bail .42 dans la plage, passerelle et DNS = ODIN, tout nom → ODIN, http://test.lan
  → page de connexion, 1.1.1.1 (TCP 443 et ping) et la box injoignables alors que la VM a internet. Cohabitation avec
  hors-ligne.sh dans les deux ordres : page joignable, rien ne sort, règle en place. B 7 : redémarrage à froid, réseau
  revenu seul ; multi-user.target à 18 s, réseau Wi-Fi à 26 s (hors de la chaîne critique) ; hostapd cassé exprès :
  5 relances puis echec-demarrage, ODIN complet, démarrage non retardé. B 8 : relance → mot de passe inchangé ;
  POINT_ACCES=0 → unités, fichiers, règles v4/v6 retirés, carte sans adresse, IPv6 rétabli, Ethernet et internet
  intacts. Avec network-manager installé (netplan garde networkd pour l'Ethernet, resté « unmanaged ») : B 1 à 5 et 8
  bons, carte « unmanaged » pendant l'option puis « disconnected » (rendue à NM) après POINT_ACCES=0. VM vierge :
  POINT_ACCES=1 sans carte → « Point d'accès Wi-Fi indisponible : Aucune carte Wi-Fi détectée », installation normale
  (166 s) ; puis radios virtuelles et relance (POINT_ACCES repris de .env) → B 1 à 5 bons.
  NON VÉRIFIÉ : vrais pilotes (Intel, MediaTek, Realtek), portée, nombre d'appareils ; B9 (lot 3). Sur de VRAIS
  appareils : les fenêtres de portail d'iOS (mini-navigateur), d'Android et de Windows ; Android après « Continuer »
  (sonde HTTPS impossible hors ligne : « connectivité limitée », il peut garder la 4G comme réseau par défaut et
  rendre ODIN injoignable ; la consigne de /portail suffit-elle ?) ; le risque de l'expérience Google
  dns_probe_private_ip_no_internet (désactivée par défaut, activable à distance) : une sonde qui résout vers une IP
  privée donnerait « échec » sans page de portail ; DNS privé / DoH forcé ; « odin.lan » pris pour une recherche.
  Premier test réel prévu : Ubuntu desktop en clé USB live (NetworkManager).

Images Docker figées sur une version précise dans compose.yml (jamais latest, main ni stable).
Une montée de version se fait volontairement, une image à la fois, après test sur odintest puis hors ligne.
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
  Mesure (odintest, 2026-09-23, tests/recherche.json : 33 questions + 3 hors sujet, dashboard/assistant/
  evaluation-recherche.mjs) : phrase brute hybride 10/33 en tête, 12/33 trouvées ; BM25 + synonymes 15/33
  en tête avec les seuils de couverture (sans seuil : 18/33 en tête, 32/33 dans les 3 premiers, MRR 0,74,
  1 hors-sujet sur 3 mal écarté), 0,35 s ; hybride + synonymes 31/33 en tête, 33/33 dans les 3 premiers,
  MRR 0,97, 3/3 hors sujet écartés, 1,9 s (Ollama) comme 2,0 s (llama.cpp). llama.cpp server-v0.4.1 avec
  ggml-org/embeddinggemma-300M-Q8_0.gguf (334 Mo, sha256 b5ce9d77…0d63) : vecteurs à 0,9997 de ceux
  d'Ollama (mêmes classements), image 1,2 Go contre 9,2 Go, 554 Mo de RAM en charge contre 943 Mo.
  Le 31/33 est OPTIMISTE : 6 expressions de la table ont été corrigées d'après les échecs de la première
  mesure (27/33 avant). Série écrite par le propriétaire (tests/serie-proprietaire.json, 20 questions ; réponses
  attendues fixées par Claude d'après son jugement, 3 sans contenu dans les packs) : 7 bons, 3 acceptables,
  7 mauvais au départ ; après les corrections ci-dessous, 9 bons, 4 acceptables, 4 mauvais ; première série
  inchangée (31/33, 33/33, 3/3). Rapport : docker exec -i dashboard node assistant/rapport-recherche.mjs < fichier.
  Corrections (2026-09-23) : terme principal = nom ou groupe nominal seulement (assistant/lexique.mjs : listes
  fermées de mots outils, verbes courants, nombres, adverbes, temps, personnes ; un titre ne commence pas par
  un pronom ou un auxiliaire ; le mot le plus rare doit figurer dans un titre ou intertitre des passages
  trouvés, sinon aucun terme). Table : expression reconnue par ses mots présents, dans n'importe quel ordre
  (petits mots ignorés, négations comptées, la plus précise d'abord, une expression incluse dans une autre déjà
  reconnue n'ajoute rien) ; ajouts demandés : jaunisse/ictère, clou/tétanos, mal au dos, faire pousser/potager,
  froid (formulations générales), infection de plaie. Urgence (securite.mjs) : aussi par groupes de mots
  présents (produit avalé, chute de hauteur, dos ou nuque après chute/choc/accident, jambes ou bras qu'on ne
  sent plus). Livres : pages de glossaire (6 définitions « Mot, m » ou plus) hors de la recherche avancée.
  Wikis : l'article au titre exact du terme de la table est lu directement dans chaque pack.
  Ordre final : cosinus + ajustements des règles (bm25.mjs, AJUSTEMENTS : titre exact +0,15, cas particulier
  -0,05, section générale +0,03), aussi pour le niveau d'affichage (passages.mjs) ; le cosinus brut reste pour
  les seuils de l'assistant. Mesuré : série du propriétaire 9/4/4 → 11 bons, 2 acceptables, 4 mauvais
  (Fièvre devant Fièvre récurrente, Ictère en tête) ; première série inchangée (31/33, 33/33, 3/3).
  CE QUI COMPTE : dans ce tableau, les étapes terme principal, bandeau, table par mots et glossaire n'ont rien
  changé au bilan ; tout le gain est venu des ENTRÉES ajoutées à la table (puis des règles dans l'ordre final).
  La qualité de la recherche dépend d'abord de la couverture de la table : chaque nouveau domaine de packs
  demandera ses entrées.
  BIAIS : les ajouts à la table viennent de la série du propriétaire, donc 11/20 est optimiste sur des questions
  neuves (comme le 31/33 de la première série). Il faut une série de CONTRÔLE écrite après coup, jamais utilisée
  pour corriger quoi que ce soit.
  TÉMOINS (ne rien ajouter à la table pour eux, décision du propriétaire) : « il fait moins dix dans la maison »,
  « mon fils a avalé de l'eau de javel », « la plaie devient verte », « le bébé ne respire plus ». Ils mesurent
  la recherche sur des formulations que la table n'a jamais vues. Reste aussi la section « Économies d'eau
  potable » devant « Traitement de l'eau non potable » (écart de cosinus 0,18, hors de portée des ajustements).
  Catalogue (point 5 du propriétaire) : aucun pack de odintest ne traite du chauffage sans électricité, des
  puits ni du potager ; ce sont des manques de contenu, pas du moteur. À couvrir par le catalogue de packs.
  Lot 4 (vecteurs par llama.cpp, installé par install.sh sur odintest) : même score 31/33, 2,2 s par question,
  indexation 4,4 morceaux/s (3,05 avec Ollama), 450 Mo de RAM ; un index construit par Ollama reste valide.
  Candidats de l'option IA (relevés le 2026-09-23, à refaire au lot 5 avec ce qui existera alors) :
  tranche 8 Go : qwen3:8b-q4_K_M (5,2 Go, texte, Apache 2.0, hybride : think false, respecté par qwen3:1.7b
  de la même famille, à revérifier) ; granite4:tiny-h (4,2 Go, texte, Apache 2.0, MoE 7B dont 1B actif,
  français non vérifié). Tranche 16 Go : qwen3:14b-q4_K_M (9,3 Go, texte, Apache 2.0, think false) ;
  ministral-3:14b-instruct-2512-q4_K_M (9,1 Go, Apache 2.0, encodeur d'images inclus). Écartés : Gemma 3
  (texte seul en 1b et 270m seulement, licence Gemma), Mistral Small 3.x (24B, 15 Go), ministral-3:8b
  (6 Go avec l'encodeur d'images). Replis de 2024 : qwen2.5:7b/14b-instruct, llama3.1:8b, mistral-nemo:12b.
- Option IA (lot 5). CHEMIN GPU NON VÉRIFIÉ : aucune carte pour tester (odintest est une VM ; seul le parcours
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
  Vérifié en simulation sur odintest (2026-09-23) : 14B refusé (8 Go), essai téléchargé, empreinte bonne, test
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
  pas de test de bout en bout avec un vrai modèle depuis le retour de odintest hors simulation.
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
  Sources : Comment faire ? (source-guides.mjs, voir « Comment faire ? »), Mes documents (index), Wiki (wikis.mjs : ZIM avec _ftindex:yes lu dans le catalogue OPDS
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
  Résultat du banc (odintest, 2026-09-22, livre de 639 pages, 1453 morceaux, 5 questions) : embeddinggemma:300m
  en 768 dimensions retenu (MRR vecteurs 0,90 ; 256 d : 0,85 ; bge-m3 : 0,75), 1,7 morceau/s contre 0,7 pour
  bge-m3, 650 Mo chargé contre 1,2 Go ; vecteurs 768 d : 29 Mo pour 10 000 morceaux. Ollama n'occupe que
  2 cœurs sur 4 par défaut : num_thread = nombre de cœurs (ancien lot 3) donne 3,05 morceaux/s (livre en 8 min) ;
  lots de 16 sans gain, gardés à 8. Poids des mots-clés 0,5 dans la fusion (bonne page en tête 2 fois sur 5
  au lieu de 1 ; 0 ferait mieux sur le livre mais perdrait les termes exacts). Question pendant une
  indexation : 50 à 370 ms. Modèles comparés (ancien lot 3, tests/documents) : qwen3:1.7b retenu (1er mot 5 s,
  16/20) ; qwen3.5:2b plus lent (9 s, 2,7 Go), lecture du prompt moins bien mise en cache, invente en issue 2.
  RAM mesurée sur odintest pendant une question : 3,3 Go utilisés sur 7,9 (Ollama 2,6 Go avec les deux modèles).

Pages : / (liaison monde, services, recherche, stockage, bandeau d'état), /configuration, /traduction, /sante, /comment-faire, /recherche (recherche avancée puis mots-clés), /lire/<pack>/<article>
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
- Place : install.sh vérifie le disque des images Docker (DockerRootDir) avant tout téléchargement : 6 Go (20 Go
  avec l'option IA, 2 Go pour une mise à jour), arrêt sinon ; avertissement sous 10 Go pour les données.
  lib/espace.mjs : chaque téléchargement (pack ZIM + 2 %, livre, carte + 5 %, modèle IA + 1 Go) réserve ce qu'il
  lui reste à écrire sur son disque (même st_dev) ; disque plein pendant l'écriture (ENOSPC) → « Disque plein ».
- Images : après chaque installation, install.sh garde par service l'image en service et la plus récente des
  autres (retour arrière possible), et retire le reste (seulement les dépôts d'ODIN).
- /var/lib/docker n'est pas déplacé par ODIN : marche à suivre dans le README (data-root).
- Mise à jour depuis main (test du 2026-09-23 sur VM vierge : main af15811 installé, mot de passe, pack climat,
  deux documents, puis installeur de dev). Conservés à l'identique (mêmes SHA-256) : data/config/auth.json (ancien
  mot de passe accepté), le pack et sa bibliothèque, data/documents (indexés ensuite), fond de carte, .env
  (complété). Retirés : conteneurs ia (Open WebUI), synchro et ollama ; images Open WebUI (7,2 Go), Ollama
  (9,2 Go), node:20 de synchro ; modèles qwen2.5:3b et bge-m3 (2,9 Go, retirés par Ollama AVANT son arrêt) ;
  data/openwebui, data/synchro. Gardés : l'image précédente du dashboard (retour arrière). Disque système :
  22 Go → 5,1 Go utilisés. Trouvé et corrigé : un clone --depth 1 -b main ne pouvait pas changer de branche
  (checkout --track refusé) ; l'échec laissait les fichiers de dev sous le HEAD de main.
- Fusion dans main le 2026-09-23 : 054013b (image figée par 306def3). Main d'avant, pour revenir en arrière si
  l'installation publique pose problème : af1581102effa1915320c9a61f015394859abbcd. Snapshot (sur l’ancienne VM nomad, voir Flux de travail) :
  avant-fusion-main. Vérifié après la fusion sur VM vierge depuis main : installation complète, pas de
  LIVRES_NON_PUBLIES dans .env, « Aucun livre n'est disponible », contrôle hors ligne (15 pages, licence sous
  l'article, aucune requête vers un autre hôte ; journal : sonde et NTP seulement).
- Fusion dans main le 2026-09-25 (traduction) : 4d4c757 (image figée par ede7f5e). Main d'avant : 306def3fdad2146481fda1f966240de4fd583a98.
  Snapshot (sur l’ancienne VM nomad, voir Flux de travail) : avant-fusion-traduction. Vérifié avant sur VM vierge (dev 76d0f8f) : installation en 158 s, fr et en
  seuls (158 Mo), LibreTranslate sans téléchargement ; allemand installé, traduit, désinstallé depuis le panneau ; relance
  de l'installeur : rien de cassé, l'allemand ne revient pas, données et mot de passe inchangés ; pack climat,
  recherche, lecteur, documents, assistant → /ia. Premier téléchargement du pack : 3 ETIMEDOUT (miroir Kiwix), bon au
  second essai.
- Fusion dans main le 2026-09-26 (point d'accès Wi-Fi lots 1 et 2, page de connexion, odintest) : acfb9e0 (image
  figée par 4f707fc). Main d'avant : 2cf0c625096be8469e524a514209ba11fb6a3ca4. Snapshot de odintest :
  avant-fusion-point-acces. Vérifié après la fusion sur VM vierge depuis main (4f707fc) : sans POINT_ACCES, installation
  normale en 155 s (7 conteneurs, aucune unité odin-*, pas de hostapd, pas de PORTAIL_* dans .env, sonde → connexion) ;
  puis radios virtuelles et installeur relancé avec POINT_ACCES=1 (36 s) : B1 à B5 bons, B6 33/33, accès par l'IP
  Ethernet sans portail, liberer → 403. odintest mise à jour ensuite (installeur, dev a3049cb, sans POINT_ACCES).
- Livres non publiés : « publie »: false dans catalogue/livres.json (Hesperian) ; proposé seulement si
  LIVRES_NON_PUBLIES=1, que install.sh écrit dans .env hors de la branche main et retire sur main. Sans livre :
  « Aucun livre n'est disponible pour l'instant. » (Configuration et /livres) ; recherche et bandeau vérifiés.
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
- Ne jamais modifier ni supprimer data/ sur odintest : ZIM, documents et mot de passe y vivent.
- Ne jamais committer data/ ni .env.
- Fins de ligne Linux obligatoires (.gitattributes) : les scripts bash cassent avec des fins de ligne Windows.
- Style : thème années 90 (angles vifs, biseaux --biseau, reliefs --relief/--creux, police --mono),
  accent or --or. Le bloc du thème est délimité dans dashboard/app/globals.css.
- Livres Hesperian (docs/conception-packs-documents.md, section 10), jusqu'à nouvel ordre du propriétaire :
  ne jamais publier la release GitHub livres-v1, et ne jamais fusionner dans main ce qui installe un livre
  Hesperian, tant que le propriétaire n'a pas reçu l'accord écrit d'Hesperian (usage numérique).
  Pourquoi (vérifié le 2026-09-23, à ne pas lever sur la seule gratuité du téléchargement) : la politique
  https://hesperian.org/open-copyright-policy/ (section « Digital Materials ») et les pages liminaires des livres
  récents exigent une autorisation écrite (permissions@hesperian.org) pour tout usage numérique, même non
  commercial ; l'autorisation sans demande de la page 2 (usage non lucratif) ne couvre pas le numérique.
  Demande écrite envoyée par le propriétaire à permissions@hesperian.org le 2026-09-23 : en attente.
  Même avec l'accord, le PDF devra venir d'Hesperian : catalogue/livres.json le prend aujourd'hui sur
  dokotoro.org, un site tiers ; changer la source (et l'empreinte) avant toute publication.
  Les tests sur odintest (branche dev) sont autorisés.

## Pièges déjà rencontrés

- kiwix-serve ajoute déjà --port=8080 ; tourne en UID 1001 ; boucle si library.xml est absent.
- Next standalone ne copie pas public/ : le Dockerfile doit le faire.
- download.kiwix.org exige curl -L ; catalogue OPDS : library.kiwix.org/catalog/v2/entries (renvoie vers
  opds.library.kiwix.org). Le filtre name ne prend qu'un nom : le catalogue entier est lu en une requête
  (count=-1, ~450 Ko compressés) et gardé 1 h (lib/catalogue.mjs).
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
- Cœurs (vérifié au lot 7, odintest 4 cœurs) : vecteurs à ~380 % pendant l'indexation (-t nproc) ; deux lots en
  parallèle ne vont pas plus vite (calcul saturé). pdftotext : un cœur par fichier, mais 1,9 s pour 639 pages,
  négligeable devant les vecteurs. Kiwix : 4 fils par défaut. Ollama : num_thread = cœurs. Aucun autre piège.
- multipass exec ne transmet pas l'entrée standard (un « cat > fichier » ou un « docker exec -i … < - » par un
  tube attend sans fin) : passer les fichiers par multipass transfer, puis docker cp ou une redirection sur la VM.
- llama.cpp server prend par défaut la moitié des cœurs : -t $(nproc) dans le point d'entrée du service vecteurs.
- Jamais de rm avec joker après un cd enchaîné par « ; » (« cd X; rm -f * » efface le dossier courant, donc le
  dépôt, si le cd échoue). Chemin absolu, dossier créé d'abord, étapes liées par && :
  S=<scratchpad>; mkdir -p "$S" && rm -f "$S"/* && cd "$S" && ...
- LibreTranslate/Argos téléchargent au premier usage le découpeur de phrases MiniSBD de chaque langue source
  (~/.local/share/argos-translate/minisbd/<code>.onnx) : il n'est pas dans les paquets Argos. Chaque pack de langue le
  pose (champ decoupage du catalogue). Un modèle manquant ne se voit qu'hors ligne : tester une traduction depuis CHAQUE langue.
- gunicorn de LibreTranslate : jamais de HUP. Le gunicorn_conf.py de l'image réécrit sys.argv au démarrage
  (on_starting) ; au HUP, gunicorn relit ces arguments, perd l'application (« No application module specified »), le
  maître s'arrête et le conteneur redémarre en entier. Pour relire les modèles : SIGTERM au worker. Pas de fichier pid
  non plus (--pid) : il survit à un kill -9 du maître et bloque le démarrage suivant (« Already running »).
- Miroirs Kiwix : download.kiwix.org renvoie vers un miroir choisi par lb.download.kiwix.org ; le 2026-09-25,
  ftp.nluug.nl ne répondait plus qu'en IPv6 depuis odintest. La VM a l'IPv6, pas les conteneurs : curl sur la VM
  passe, le dashboard échoue (UND_ERR_CONNECT_TIMEOUT). Tester avec curl -4 avant de chercher dans ODIN.
- /run est monté noexec sur Ubuntu : un script d'accroche (udhcpc -s, dhcpcd -c) placé dans /run n'est jamais
  exécuté, sans erreur visible. Les mettre ailleurs (/var/lib/…).
- iw : les modes sont indentés « \t\t * AP » (deux tabulations, une espace) ; « AP » apparaît aussi dans AP/VLAN et
  dans « valid interface combinations » : ne lire que la section Supported interface modes.
- mac80211_hwsim n'est pas dans l'image cloud d'Ubuntu : paquet linux-modules-extra-$(uname -r).
- NetworkManager, liste unmanaged-devices : une spec « except: » qui correspond l'emporte sur toute la liste. Pour
  écarter une seule carte, une section [device-xxx] avec match-device et managed=0 ; vérifier au démarrage dans le
  journal de NM (« state change »), --print-config ne suffit pas.
- Hors ligne, chaque résolution DNS bloque un fil libuv plusieurs secondes et les lectures de fichiers
  attendent derrière : UV_THREADPOOL_SIZE=16 dans l'image du dashboard.

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
Assistant documentaire : le test sur VM vierge (et le test hors ligne) est reporté à la fin du lot 5
(installeur final) ; les lots 1 à 4 se testent sur nomad.
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
- ollama : moteur des modèles de l'assistant, joignable seulement sur le réseau Docker interne
  (http://ollama:11434), aucun port publié.
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

- Assistant documentaire (en construction, lots 1 à 5) : remplace Open WebUI et synchro, retirés au lot 1.
  Décisions validées : UI, API et ingestion dans le dashboard ; Node 24 pour node:sqlite (FTS5), aucune
  dépendance npm ajoutée ; pas de sqlite-vec ; OLLAMA_MAX_LOADED_MODELS=2 et keep_alive (30m) sur les deux
  modèles ; /assistant et son API derrière l'authentification, flux non tamponné par Caddy.
  qwen3:4b désigne la version « thinking » : figer qwen3:4b-instruct-2507-q4_K_M. install.sh contient un bloc
  de migration (retrait d'Open WebUI, synchro, qwen2.5:3b, bge-m3, data/openwebui, data/synchro), à retirer
  après la v1.
  Index (lot 2) : dashboard/assistant/*.mjs tourne dans un worker_thread (jamais sur la boucle d'événements
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
  4 extraits ; le meilleur cosinus brut est rendu à part (seuils du lot 3). Sans Ollama, mots-clés seuls.
  Appels Ollama : délai d'inactivité (120 s, en-têtes ou données), jamais de délai total.
  Priorité aux questions : une recherche coupe l'appel d'indexation en cours (refait ensuite) et suspend
  l'indexation jusqu'à la fin de la réponse (jeton rendu par rechercher({ garder: true }), reprendre(jeton),
  reprise forcée après 5 min). Les résumés d'une ligne (modèle de langage, après l'indexation) cèdent aussi.
  PDF dont le texte fait moins de 30 lettres par page : statut probleme, « PDF sans texte (probablement scanné) ».
  Réponse (lot 3) : assistant/reponse.mjs (générateur d'événements etat/texte/fin/erreur, sans dépendance à
  Next, partagé par la route et l'évaluation), prompt.mjs (noyau verrouillé + personnalité, exemples en tours
  de dialogue, rappel du tutoiement dans le dernier message : les petits modèles suivent le dernier message),
  reglages.mjs (défauts et validation ; fichier data/config/assistant.json, modèle par MODELE_CHAT du .env).
  Issue décidée par le meilleur cosinus avant tout appel : ≥ seuilReponse (0,40) réponse, ≥ seuilProches
  (0,18) documents proches, sinon phrase « je ne sais pas » sans appel. Seuls les extraits à moins de 0,1 du
  meilleur cosinus (ou 2 premiers par mots-clés) vont au modèle : un extrait hors sujet l'égare et coûte ~4 s.
  [NON_TROUVE] détecté sur le début du flux → issue 2. Issue 2 retenue en entier et vérifiée : un nombre
  absent de la question, des titres et des résumés remplace le texte par une phrase fixe.
  Route POST /api/assistant/question : NDJSON en flux (Cache-Control no-transform : sinon la compression de
  Next retient les morceaux) ; Caddy le laisse passer sans tampon (vérifié). /api/assistant/* sans connexion :
  401 JSON (verifier/route.js) ; les pages restent en redirection. Sources : PDF dans la visionneuse
  (/assistant/document?chemin=&page=), autres fichiers par Caddy sur /fichiers-documents/* (lecture seule,
  CSP sandbox). Ce préfixe ne doit pas commencer par /documents, déjà pris par FileBrowser (handle /documents*).
  Modèle de langage : qwen3:1.7b (≤ 8,5 Go de RAM détectée, écrit dans .env par install.sh) ou
  qwen3:4b-instruct-2507-q4_K_M. Options identiques à chaque appel (num_ctx 4096, num_thread = cœurs,
  think false) : une valeur différente recharge le modèle. Ollama garde en cache le début commun du prompt
  (noyau + exemples) : ne rien y mettre qui change à chaque question.
  Compréhension (assistant/comprehension.mjs) avant toute recherche : JSON strict (format = schéma
  Ollama) → conversation (réponse courte, aucune recherche, aucun chiffre) ou information (question
  autonome, requête de mots-clés, terme principal, drapeau santé). JSON invalide : la phrase brute.
  Sources : Mes documents (index), Wiki (wikis.mjs : ZIM avec _ftindex:yes lu dans le catalogue OPDS
  LOCAL, deux requêtes en parallèle, 15 articles, paragraphes ≥ 60 caractères coupés à 700, BM25 local,
  8 vectorisés), Livres (source-livres.mjs : pages.json des livres installés, 4 paragraphes vectorisés).
  Classement commun par cosinus ; le meilleur résultat par mots-clés des documents garde sa place.
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
  2 cœurs sur 4 par défaut : num_thread = nombre de cœurs (lot 3) donne 3,05 morceaux/s (livre en 8 min) ;
  lots de 16 sans gain, gardés à 8. Poids des mots-clés 0,5 dans la fusion (bonne page en tête 2 fois sur 5
  au lieu de 1 ; 0 ferait mieux sur le livre mais perdrait les termes exacts). Question pendant une
  indexation : 50 à 370 ms. Modèles comparés (lot 3, tests/documents) : qwen3:1.7b retenu (1er mot 5 s,
  16/20) ; qwen3.5:2b plus lent (9 s, 2,7 Go), lecture du prompt moins bien mise en cache, invente en issue 2.
  RAM mesurée sur nomad pendant une question : 3,3 Go utilisés sur 7,9 (Ollama 2,6 Go avec les deux modèles).

Pages : / (liaison monde, services, recherche, stockage), /configuration, /recherche, /lire/<pack>/<article>
(lecteur maison), /ouvrir/<service> (cadre avec barre ODIN), /connexion.

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
- Hors ligne, chaque résolution DNS bloque un fil libuv plusieurs secondes et les lectures de fichiers
  attendent derrière : UV_THREADPOOL_SIZE=16 dans l'image du dashboard.

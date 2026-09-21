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
  pendant qu'un flux se télécharge. Exception voulue : les packs de cartes n'ont pas de délai
  d'inactivité (pmtiles extract a une longue phase de préparation silencieuse) ; l'annulation est manuelle.
- Aucun CDN, police externe, analytique ou vérification de mise à jour. Pour une image tierce,
  désactiver ces fonctions par variable d'environnement (Open WebUI : OFFLINE_MODE=true).
- Tout ce qu'un service télécharge au premier usage (modèles, index, caches) doit être
  téléchargé pendant l'installation, pas à la première utilisation hors ligne.
- Toute nouvelle fonction qui touche au réseau passe le test hors ligne (voir « Test hors ligne »).

## Flux de travail

Ce dépôt, sur Windows, est le seul endroit où le code se modifie.
Le serveur de test est la VM Multipass "nomad" (Ubuntu 24.04, 192.168.129.19), où le dépôt est
cloné dans /opt/odin. Ne jamais y modifier de fichier directement : il ne fait que git pull.

- On travaille sur la branche dev. nomad suit dev.
- Pour tester : commit et push sur dev, puis
  multipass exec nomad -- bash -lc "cd /opt/odin && git pull && docker compose -f compose.yml -f compose.dev.yml up -d --build"
- Le propriétaire vérifie dans son navigateur sur http://192.168.129.19
- Une fois validé : fusionner dev dans main et pousser. C'est main que récupère l'installeur.
- Image du dashboard : à chaque push sur main ou dev touchant dashboard/, GitHub Actions publie
  ghcr.io/gorgo126/odin-dashboard:<sha> puis fige le compose.yml de cette branche sur cette image, par
  un commit automatique (github-actions[bot]). Faire git pull avant de repousser. L'installeur prend
  donc l'image de la branche clonée (BRANCHE). Suivre un build : gh run list / gh run watch.
- Revenir sur nomad à l'image publiée : ... && docker compose pull dashboard && docker compose up -d
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
NOM_HOTE=test est obligatoire : sinon la VM se renomme "odin" et, au redémarrage, Multipass ne la
joint plus (il la cherche sous test.mshome.net). Arrêter/démarrer la VM : multipass stop test / start test.
Supprimer ensuite la VM de test (multipass delete test --purge), jamais nomad.
La VM vierge installe l'image publiée pour la branche : après un push touchant le dashboard,
attendre le commit automatique de GitHub Actions et installer depuis ce commit.
Mémoire : nomad et test (8 Go chacune) ne tiennent pas ensemble ; arrêter nomad pendant le test.

### Test hors ligne

Sur une VM test, jamais sur nomad (il modifie le pare-feu du système). Coupe internet mais garde
le réseau local, comme une box sans accès internet ; chaque tentative bloquée est journalisée.

1. Préparer en ligne (VM vierge ci-dessus) : mot de passe, un petit pack (climat), un PDF dans
   Documents, une question à l'IA.
2. Couper : sudo /opt/odin/scripts/hors-ligne.sh couper (persiste au redémarrage).
3. Redémarrer à froid (multipass stop test, puis multipass start test), puis vérifier : 7 conteneurs, logs de synchro, connexion,
   accueil, recherche, lecteur, /kiwix, dépôt d'un document puis question sur lui à l'IA,
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

- caddy : façade unique, ports ${HTTP_PORT}:80 et ${IA_PORT}:8081. Routes /documents  filebrowser,
  /kiwix  kiwix, reste  dashboard. :8081  Open WebUI. auto_https off.
  Après toute modification du Caddyfile : docker compose restart caddy (up -d ne le relit pas).
- Authentification unique : forward_auth vers /api/auth/verifier du dashboard. Mot de passe choisi à la
  première visite (data/config/auth.json). Les chemins accessibles sans connexion sont listés dans @public.
- dashboard : Next.js 15 (app router, output standalone) dans dashboard/. Dépendances : Next, React, et pour
  la carte seulement maplibre-gl, pmtiles et @protomaps/basemaps, en versions exactes. Rien d'autre.
- kiwix : moteur invisible, lit data/zim/library.xml (--monitorLibrary, --skipInvalid).
- ollama + ia (Open WebUI, WEBUI_AUTH=false) : qwen2.5:3b pour discuter, bge-m3 pour l'indexation.
- filebrowser : FileBrowser Quantum (gtstef/filebrowser), noauth, config/filebrowser.yaml.
- synchro : node:20-alpine + synchro/synchro.mjs, répercute data/documents vers la collection
  Open WebUI "Mes documents" et cache bge-m3 du sélecteur.
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

Pages : / (services, recherche, stockage), /configuration, /recherche, /lire/<pack>/<article>
(lecteur maison), /ouvrir/<service> (cadre avec barre ODIN), /connexion.

## Règles

- Rien en dur : ni IP, ni ports, ni noms de fichiers. Configuration dans .env, modèle dans .env.exemple.
- Tout doit fonctionner hors ligne à l'exécution : voir « Principe hors ligne ».
- Ne jamais modifier ni supprimer data/ sur nomad : ZIM, documents et mot de passe y vivent.
- Ne jamais committer data/ ni .env.
- Fins de ligne Linux obligatoires (.gitattributes) : les scripts bash cassent avec des fins de ligne Windows.
- Style : thème années 90 (angles vifs, biseaux --biseau, reliefs --relief/--creux, police --mono),
  accent or --or. Le bloc du thème est délimité dans dashboard/app/globals.css.

## Pièges déjà rencontrés

- kiwix-serve ajoute déjà --port=8080 ; tourne en UID 1001 ; boucle si library.xml est absent.
- Open WebUI ne supporte pas un sous-chemin ; ses réglages sont figés au premier démarrage
  et ignorent ensuite les variables d'environnement (OFFLINE_MODE fait exception, lue à chaque démarrage).
  Les permissions USER_PERMISSIONS_* ne s'appliquent pas aux administrateurs ; avec WEBUI_AUTH=false,
  tout le monde est administrateur.
- Next standalone ne copie pas public/ : le Dockerfile doit le faire.
- download.kiwix.org exige curl -L ; catalogue OPDS : library.kiwix.org/catalog/v2/entries.
- Le build arm64 émulé bloque GitHub Actions.
- raw.githubusercontent.com garde un cache jusqu'à 5 minutes : tester avec l'identifiant du commit.
- VM renommée par l'installeur : Windows garde l'ancienne adresse dans hosts.ics et Multipass reste
  bloqué. D'où NOM_HOTE=test pour les VM de test.
- MapLibre 6 déduit l'adresse de son worker de import.meta.url : regroupé par webpack, il la perd. Il est
  donc copié tel quel dans public/ (scripts/ressources-carte.mjs, prebuild) et importé avec webpackIgnore.
- MapLibre 6 dessine lui-même l'arabe et l'hébreu ; le module RTL est obsolète et remplacerait ce rendu.
- pmtiles extract réserve la taille finale du fichier dès le début : la progression se lit dans sa
  sortie (« NN% | »), pas dans la taille du .part. Une extraction interrompue repart de zéro.
- Hors ligne, chaque résolution DNS bloque un fil libuv plusieurs secondes et les lectures de fichiers
  attendent derrière : UV_THREADPOOL_SIZE=16 dans l'image du dashboard.

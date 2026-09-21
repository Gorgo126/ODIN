# ODIN  Offline Data & Information Node

Serveur de connaissances hors ligne, installable en une commande sur Ubuntu/Debian.
Inspiré de Project NOMAD, reconstruit de zéro, en plus simple, pensé francophone.
Le propriétaire préfère avancer vite et concrètement. Réponses en français.

## Flux de travail

Ce dépôt, sur Windows, est le seul endroit où le code se modifie.
Le serveur de test est la VM Multipass "nomad" (Ubuntu 24.04, 192.168.129.19), où le dépôt est
cloné dans /opt/odin. Ne jamais y modifier de fichier directement : il ne fait que git pull.

- On travaille sur la branche dev. nomad suit dev.
- Pour tester : commit et push sur dev, puis
  multipass exec nomad -- bash -lc "cd /opt/odin && git pull && docker compose -f compose.yml -f compose.dev.yml up -d --build"
- Le propriétaire vérifie dans son navigateur sur http://192.168.129.19
- Une fois validé : fusionner dev dans main et pousser. GitHub Actions publie alors l'image du dashboard
  sur GHCR, et c'est main que récupère l'installeur.
- Revenir sur nomad à l'image publiée : ... && docker compose pull dashboard && docker compose up -d
- Logs : multipass exec nomad -- bash -lc "cd /opt/odin && docker compose logs --tail 50 <service>"
- Tester une route interne sans authentification :
  multipass exec nomad -- docker exec caddy wget -qO- http://dashboard:3000/...

Avant une modification importante, proposer un snapshot :
multipass stop nomad && multipass snapshot nomad --name <nom> && multipass start nomad
Ne jamais restaurer ni supprimer une VM sans l'accord explicite du propriétaire.

Toute modification de install.sh doit être validée sur une VM vierge :
multipass launch 24.04 --name test --cpus 4 --memory 8G --disk 40G --network Ethernet
puis curl de install.sh depuis raw.githubusercontent.com/Gorgo126/ODIN/<commit>/install.sh et sudo bash.
Supprimer ensuite la VM de test (multipass delete test --purge), jamais nomad.

## Architecture

Un seul compose.yml écrit à la main, aucun orchestrateur.

- caddy : façade unique, ports ${HTTP_PORT}:80 et ${IA_PORT}:8081. Routes /documents  filebrowser,
  /kiwix  kiwix, reste  dashboard. :8081  Open WebUI. auto_https off.
  Après toute modification du Caddyfile : docker compose restart caddy (up -d ne le relit pas).
- Authentification unique : forward_auth vers /api/auth/verifier du dashboard. Mot de passe choisi à la
  première visite (data/config/auth.json). Les chemins accessibles sans connexion sont listés dans @public.
- dashboard : Next.js 15 (app router, output standalone) dans dashboard/. Aucune dépendance hors Next et React.
- kiwix : moteur invisible, lit data/zim/library.xml (--monitorLibrary, --skipInvalid).
- ollama + ia (Open WebUI, WEBUI_AUTH=false) : qwen2.5:3b pour discuter, bge-m3 pour l'indexation.
- filebrowser : FileBrowser Quantum (gtstef/filebrowser:stable), noauth, config/filebrowser.yaml.
- synchro : node:20-alpine + synchro/synchro.mjs, répercute data/documents vers la collection
  Open WebUI "Mes documents" et cache bge-m3 du sélecteur.

Pages : / (services, recherche, stockage), /configuration, /recherche, /lire/<pack>/<article>
(lecteur maison), /ouvrir/<service> (cadre avec barre ODIN), /connexion.

## Règles

- Rien en dur : ni IP, ni ports, ni noms de fichiers. Configuration dans .env, modèle dans .env.exemple.
- Tout doit fonctionner hors ligne à l'exécution : aucun CDN, aucune police externe, aucun appel réseau.
- Ne jamais modifier ni supprimer data/ sur nomad : ZIM, documents et mot de passe y vivent.
- Ne jamais committer data/ ni .env.
- Fins de ligne Linux obligatoires (.gitattributes) : les scripts bash cassent avec des fins de ligne Windows.
- Style : thème années 90 (angles vifs, biseaux --biseau, reliefs --relief/--creux, police --mono),
  accent or --or. Le bloc du thème est délimité dans dashboard/app/globals.css.

## Pièges déjà rencontrés

- kiwix-serve ajoute déjà --port=8080 ; tourne en UID 1001 ; boucle si library.xml est absent.
- Open WebUI ne supporte pas un sous-chemin ; ses réglages sont figés au premier démarrage
  et ignorent ensuite les variables d'environnement.
- Next standalone ne copie pas public/ : le Dockerfile doit le faire.
- download.kiwix.org exige curl -L ; catalogue OPDS : library.kiwix.org/catalog/v2/entries.
- Le build arm64 émulé bloque GitHub Actions.
- raw.githubusercontent.com garde un cache jusqu'à 5 minutes : tester avec l'identifiant du commit.

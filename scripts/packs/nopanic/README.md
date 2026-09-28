# Pack ZIM « NoPanic — Articles »

Ce script construit un fichier ZIM avec les articles de quatre rubriques du site NoPanic
(https://nopanic.fr), sous-rubriques comprises : Outdoor, Autonomie, Low Tech et Prepper
(`survivaliste-prepper`).

## Accord de NoPanic

Le 27/09/2026, NoPanic a autorisé ODIN à intégrer tels quels les contenus créés et publiés
par NoPanic, à condition de citer la source et de mettre un lien vers https://nopanic.fr.

Le pack respecte ces conditions :

- la page d'accueil du ZIM crédite NoPanic et renvoie vers https://nopanic.fr ;
- chaque article commence par « Article de NoPanic — publié le <date> — lire en ligne :
  <adresse d'origine> » ;
- le texte des articles n'est ni réécrit ni coupé.

## Ce que contient chaque article

Chaque article contient son titre, sa date de publication, le corps du texte et les images du
corps. Rien d'autre n'est gardé : ni commentaires, ni barre latérale, ni menus, ni boutons de
partage, ni articles liés, ni newsletter, ni encarts publicitaires ou de boutique. Le script
prend `content.rendered` dans l'API REST de WordPress : ces éléments du thème n'y figurent
pas.

Le nettoyage ne touche qu'à la structure (`nettoyage.py`) :

- scripts, iframes, formulaires, blocs de partage et widgets sont retirés ;
- chaque vidéo intégrée (YouTube, Vimeo, Dailymotion, fichier vidéo) devient un lien
  « ▶ Vidéo … (voir en ligne) ». Les autres contenus intégrés (cartes, publications
  Instagram) deviennent aussi un lien ;
- pour chaque image, une seule taille est gardée : celle du `srcset` la plus proche de
  1024 px de large, sinon `src`. L'image est enregistrée dans le ZIM sous `images/`. Les
  images hébergées hors de nopanic.fr restent sur le web et sont listées dans
  `out/images-externes.txt` ;
- un lien vers un autre article inclus devient un lien interne au ZIM. Un lien vers une
  page de rubrique ou de sous-rubrique incluse mène à sa section de l'accueil du ZIM
  (`accueil#outdoor`, `accueil#cat-bivouac`). Tous les autres liens restent vers le web.

## Articles retenus : auteurs autorisés et exclusions

L'accord porte sur les contenus créés et publiés par NoPanic. Deux règles s'appliquent à chaque
génération, mises à jour comprises (décisions du 28/09/2026) :

- seuls les articles des auteurs WordPress de NoPanic sont retenus : `admin` (Sven) et
  `thom-mat` (Mat & Thom), liste `AUTEURS_AUTORISES` de `nopanic.py`. L'auteur vient du champ
  `author` de l'API, et son identifiant de `/wp-json/wp/v2/users`. Un article d'un autre
  auteur est exclu automatiquement, et le journal l'indique (« Exclu (auteur non autorisé :
  … ) ») ;
- la liste `EXCLUS` retire des articles précis, avec leur raison. Elle contient 9 articles :
  4 écrits par un lecteur, un ami ou un abonné (`deplacer-ville-effondrement`,
  `guide-survie-inondation`, `se-soigner-dans-la-nature`, `review-lampe-tactique`) et 5
  articles d'auteurs invités (`se-liberer-du-smartphone`, `suivi-mesure-trail`,
  `tir-arc-nature`, `chargeur-solaire-rohs`, `aquaponie`).

Les liens des autres articles vers un article écarté restent des liens vers le web.

## Récupération polie

- Le script lit robots.txt et le respecte.
- Il fait une requête à la fois, avec au moins une seconde d'attente entre deux requêtes.
- Il s'annonce avec le user-agent `ODIN-offline-pack (+https://github.com/Gorgo126/ODIN)`.
- Chaque réponse est gardée dans `.cache/` et n'est jamais retéléchargée.

## Relancer

Il faut Python 3.10 ou plus récent. Dans ce dossier :

```bash
python3 -m venv .venv          # ou : uv venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python nopanic.py tout                 # récupère (réseau), puis construit le ZIM
.venv/bin/python nopanic.py construire           # reconstruit depuis le cache, sans réseau
.venv/bin/python nopanic.py tout --complet       # relit tous les articles de l'API
```

`recuperer` est incrémental :

1. Il repart de l'état de la dernière génération : `.cache/etat.json` (articles, catégories,
   auteurs, date de génération), sinon `.precedent/etat.json.gz`, publié avec la dernière
   release.
2. Il relit la liste des catégories et la liste légère des articles du périmètre
   (identifiant, date de modification, auteur, catégories). Cette liste détecte les articles
   retirés, déplacés ou changés d'auteur.
3. Il ne demande le contenu que des articles modifiés depuis la dernière génération
   (`modified_after`, avec une marge de 2 jours, car l'API compare l'heure locale du site),
   ainsi que des articles entrés dans le périmètre.
4. Il télécharge seulement les images absentes, à la fois du cache et du ZIM précédent
   (`.precedent/*.zim`).

Une mise à jour sans changement fait une dizaine de requêtes. Les listes de l'API ne sont
jamais mises en cache ; les images le sont pour toujours (même adresse, même fichier).

`construire` ne fait aucune requête réseau. Il lit `.cache/etat.json` et les images du cache.

Résultats dans `out/` :

- `nopanic_fr_articles_maxi_<AAAA-MM-JJ>.zim` : nom au format Kiwix, par lequel ODIN retrouve
  les fichiers du pack ;
- `<même nom>.sha256` ;
- `etat.json.gz` : état publié avec la release, pour la mise à jour suivante ;
- `fiche.json` : entrée du catalogue d'ODIN (taille, SHA-256, UUID, date, nombre d'entrées) ;
- `rapport.json` : articles par rubrique, auteurs, images, vidéos remplacées, liens internes
  et de rubrique ;
- `recuperation.json` : durée, requêtes, octets, images reprises du ZIM précédent, échecs ;
- `images-externes.txt`.

`nopanic.py fiche --url <adresse du ZIM publié>` écrit l'entrée `nopanic` de
`catalogue/packs-odin.json`.

`.venv/`, `.uv/`, `.cache/`, `.precedent/`, `out/` et `.kiwix/` ne vont pas dans git.

## Publication (GitHub Actions)

`.github/workflows/pack-nopanic.yml` tourne chaque trimestre (le 2 janvier, avril, juillet et
octobre), ou à la main (Actions → Pack NoPanic → Run workflow ; option « complet »).

1. Il reprend le cache de l'exécution précédente (actions/cache). S'il n'y en a pas, il
   télécharge `etat.json.gz` et le ZIM de la dernière release `nopanic-*`.
2. Il lance `recuperer`, puis `construire`.
3. Il publie une release `nopanic-<date>-<numéro d'exécution>` avec le ZIM, son `.sha256`,
   `etat.json.gz` et `rapport.json`.
4. Il écrit l'adresse, la taille, le SHA-256 et la date dans `catalogue/packs-odin.json`, puis
   commite sur la branche où il a tourné.

Le cache d'actions/cache disparaît après 7 jours sans usage : entre deux trimestres, c'est la
release précédente qui sert de point de départ.

Les exécutions planifiées et le bouton « Run workflow » de l'interface ne voient que les
workflows présents sur la branche par défaut (main). Tant que le workflow n'existe que sur dev,
il se lance par `gh workflow run pack-nopanic.yml --ref dev`. Un déclencheur `push` limité à
son propre fichier l'a fait connaître de GitHub ; son job est ignoré sur ce déclencheur.

## Tester le ZIM

```bash
.kiwix/kiwix-serve --port 8095 out/nopanic_fr_articles_maxi_*.zim
```

Ouvrir ensuite http://localhost:8095. Pour obtenir kiwix-serve, prendre l'archive
`kiwix-tools_linux-x86_64.tar.gz` sur download.kiwix.org/release/kiwix-tools/ et la
décompresser dans `.kiwix/`.

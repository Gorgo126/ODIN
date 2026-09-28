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
- un lien vers un autre article inclus devient un lien interne au ZIM. Tous les autres liens
  restent vers le web, y compris ceux vers les pages de rubrique du site.

## Articles exclus

Quatre articles ont été écrits par un lecteur ou un ami de NoPanic, et non par NoPanic : ils
sont retirés du pack (liste `EXCLUS` de `nopanic.py`, décision du 28/09/2026). Ce sont
`deplacer-ville-effondrement`, `guide-survie-inondation`, `se-soigner-dans-la-nature` et
`review-lampe-tactique`. Les liens des autres articles vers eux restent des liens vers le web.

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
.venv/bin/python nopanic.py tout --rafraichir    # relit l'API pour trouver les nouveaux articles
```

La commande `construire` ne fait aucune requête réseau. Si une ressource manque dans le cache,
elle s'arrête ou signale l'image manquante dans le rapport. L'option `--rafraichir` relit
seulement les listes de l'API (catégories et articles). Elle ne retélécharge jamais une image
déjà présente dans le cache.

Résultats dans `out/` :

- `nopanic_fr_articles_<AAAA-MM>.zim` ;
- `rapport.json` : articles par rubrique, images, vidéos remplacées, liens internes ;
- `recuperation.json` : durée, requêtes, octets, échecs ;
- `images-externes.txt`.

`.venv/`, `.uv/`, `.cache/`, `out/` et `.kiwix/` ne vont pas dans git.

## Tester le ZIM

```bash
.kiwix/kiwix-serve --port 8095 out/nopanic_fr_articles_*.zim
```

Ouvrir ensuite http://localhost:8095. Pour obtenir kiwix-serve, prendre l'archive
`kiwix-tools_linux-x86_64.tar.gz` sur download.kiwix.org/release/kiwix-tools/ et la
décompresser dans `.kiwix/`.

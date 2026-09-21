# Packs « livre » (PDF) : proposition de conception

Statut : **proposition, à valider avant toute implémentation.** Rien n'est codé.
Premier cas réel : *Là où il n'y a pas de docteur* (Hesperian, édition française 2019).

## 0. Ce qui existe aujourd'hui (état des lieux)

| Brique | Fonctionnement actuel | Conséquence pour les PDF |
|---|---|---|
| Catalogue | `catalogue/packs.txt`, 18 lignes `id\|nom kiwix\|variante\|libellé`. Titre, taille et URL viennent de l'OPDS Kiwix, en ligne (`lib/catalogue.mjs`). | Un PDF n'a pas d'OPDS : **toutes** ses métadonnées doivent être dans notre catalogue. |
| Installation | `lib/telechargements.mjs` : `demarrer(id)` passe par `enLigne()`, vérifie l'espace disque, télécharge en `.part` avec reprise (`telechargerFlux`, 30 s d'inactivité par défaut, `null` possible), renomme, puis inscrit le livre dans `library.xml`. | La mécanique est réutilisable telle quelle. Il faut ajouter le SHA-256 et le miroir. |
| Désinstallation | **Aucune pour les ZIM.** Le `DELETE /api/packs/[id]` ne fait qu'annuler un téléchargement. Les cartes, elles, se suppriment (`supprimer()` dans `lib/cartes.mjs`). | Le livre aura une vraie désinstallation, calquée sur les cartes. |
| Recherche unifiée | `/recherche` n'interroge que `kiwix-serve` (`/kiwix/search`, XML), 20 résultats par page ; le lien réécrit `/kiwix/content/` en `/lire/`. | Kiwix n'indexe pas les PDF : il faut **notre propre index**, fusionné à l'affichage. |
| Lecteur | `/lire/[livre]/[...chemin]` : HTML de Kiwix nettoyé, liens externes marqués `data-externe` et grisés hors ligne. | Ne s'applique pas au PDF : il faut une visionneuse dédiée. |
| Synchro | `synchro/synchro.mjs` : `data/documents` (monté en lecture seule), une seule collection Open WebUI « Mes documents », un état dans `data/synchro/etat.json`. Elle crée déjà des modèles par l'API (`masquerModeles`). | Il faut une 2ᵉ source et une 2ᵉ collection. L'API modèles est déjà maîtrisée. |
| Services web | Caddy sert `/tuiles/*` en `file_server` (requêtes Range), derrière `forward_auth`. | Même modèle pour servir les PDF. |

### Mesures faites sur le vrai fichier (le 21/09/2026, dans la zone temporaire, pas dans le dépôt)

- `https://dokotoro.org/wp-content/uploads/2020/07/French-Edition.pdf` : HTTP 200, `application/pdf`,
  **13 178 244 octets** (12,6 Mio), `Accept-Ranges: bytes` (reprise possible), `Last-Modified: 29/07/2020`.
- **SHA-256 : `6f27a90a8e6fb134a624b477a822cd135a1a18e2bad7cc8118e7d5aba6e4c404`**
- PDF 1.6 **linéarisé**, **639 pages**. Pas d'étiquettes de page, pas de métadonnées titre ou auteur.
- **Couche texte présente et propre**, accents compris : 1,42 million de caractères, seulement 6 pages
  quasi vides. Pas besoin d'OCR.
- **Le numéro imprimé correspond au numéro de page du PDF** : la page 200 du PDF commence par
  « 200 Chapitre 11 : … ». Une citation « p. 412 » renvoie donc à la même page à l'écran et sur papier.
- Chaque page paire porte un en-tête courant « NNN Chapitre X : titre ». On peut en déduire le chapitre
  de chaque résultat. Le chapitre 25 « Médicaments » couvre les pages 514 à 600 environ.
- Extraction avec pdf.js 5.6.205 sous Node 20.20 (celui de l'image) : **4,4 s, 219 Mo de mémoire au pic**,
  texte par page en JSON : 1,6 Mo.
- Recherche naïve en mémoire sur ce texte, accents ignorés : **1 à 3 ms par requête**, 19 Mo de mémoire.
  « paracétamol dose » donne les pages 566, 585, 565… ; « morsure de serpent » donne 179, 180, 583…
- ⚠️ pdf.js 5.7 et 6.x exigent Node 22 : sous Node 20, il faut rester en **5.6.205** au plus.

## 1. Vocabulaire

Aujourd'hui, « Documents » désigne déjà les **fichiers personnels** (FileBrowser et la collection IA
« Mes documents »). Appeler les PDF du catalogue « documents » créerait une confusion permanente.

| Terme | Sens | Où on le voit |
|---|---|---|
| **Pack** | Tout ce qui s'installe depuis le catalogue (terme générique, surtout interne) | Configuration |
| **Encyclopédie** | Pack ZIM (Wikipédia, Wiktionnaire…) ; ses résultats sont des **articles** | Catalogue, recherche |
| **Livre** | Pack PDF (Hesperian…) ; ses résultats sont des **pages** | Catalogue, recherche, bibliothèque |
| **Documents** | Fichiers personnels, inchangé | FileBrowser, IA |
| **Bibliothèque** | L'ensemble du contenu installé : encyclopédies et livres | Page dédiée |

Recommandation : **« Livre »** dans l'interface, `livre` dans le code (`lib/livres.mjs`, `/api/livres`,
`data/livres`). Le type technique reste `pdf`, pour accueillir plus tard un autre format (EPUB).

## 2. Catalogue

### Format : un fichier séparé, `catalogue/documents.json`

Pourquoi un fichier séparé :
- `packs.txt` reste **intact** : les 18 packs ZIM, leur code (`lirePacks`) et l'installeur ne voient rien changer ;
- le format à barres verticales ne supporte pas une douzaine de champs, dont des URL et une phrase d'attribution ;
- JSON est lisible par Node sans dépendance.

Le fichier s'appelle `documents.json` comme demandé. On peut aussi le nommer `livres.json`, pour suivre
le vocabulaire (voir question Q1).

```json
[
  {
    "id": "pas-de-docteur",
    "type": "pdf",
    "titre": "Là où il n'y a pas de docteur",
    "sousTitre": "Un guide de santé villageois",
    "auteurs": ["David Werner", "Carol Thuman", "Jane Maxwell"],
    "editeur": "Hesperian Health Guides",
    "edition": "Édition française 2019",
    "langue": "fra",
    "categorie": "sante",
    "pages": 639,
    "licence": {
      "nom": "Licence ouverte Hesperian",
      "url": "<URL des conditions, à fournir>",
      "conditions": "Usage non lucratif, attribution obligatoire, fichier non modifié"
    },
    "attribution": "Là où il n'y a pas de docteur, © Hesperian Health Guides. Reproduit sans modification, à des fins non lucratives.",
    "sources": [
      "https://dokotoro.org/wp-content/uploads/2020/07/French-Edition.pdf",
      "<URL miroir, à décider (Q3)>"
    ],
    "sha256": "6f27a90a8e6fb134a624b477a822cd135a1a18e2bad7cc8118e7d5aba6e4c404",
    "taille": 13178244,
    "soutien": "<URL de dons ou du site de l'éditeur, à fournir>",
    "avertissement": "sante",
    "description": "Guide de santé de référence pour les soins de base, là où les services médicaux manquent."
  }
]
```

Règles :
- **Tout est fixé dans le catalogue** : taille et SHA-256 connus d'avance, contrairement aux ZIM dont
  la taille vient de l'OPDS. La taille s'affiche donc hors ligne sans mesure préalable.
- `langue` suit la norme ISO 639-3 (`fra`), comme Kiwix.
- `categorie` prend ses valeurs dans une liste courte (sante, eau, energie, agriculture, technique…) qui sert
  au regroupement et à l'icône.
- `sources` est ordonné : la source officielle d'abord, les miroirs ensuite.
- `avertissement: "sante"` déclenche les avertissements médicaux (lecteur, recherche, IA).
- Validation au chargement : un champ manquant ou un SHA-256 mal formé exclut l'entrée avec un message dans
  les logs, **sans faire tomber la page Configuration**.
- **Aucune URL inventée** : l'URL de la licence, le miroir et la page de dons sont à fournir (voir Q3 et Q4).

## 3. Différenciation avec les packs ZIM

### Configuration : un panneau séparé « Livres »

Il s'ajoute au-dessus ou au-dessous du panneau « Bibliothèque » actuel, qui devient « Encyclopédies »
(voir Q2). Même composant `Panneau`, avec :
- **une icône propre** : un livre fermé avec un signet. L'icône actuelle, un livre ouvert, reste pour les encyclopédies ;
- **un badge `LIVRE · PDF`** en `--mono`, bordure or ;
- **une fiche par livre** : titre, auteurs, édition, nombre de pages, taille (connue hors ligne), licence ;
  bouton Installer, Annuler ou Désinstaller ; lien « Soutenir l'éditeur » (grisé hors ligne).

Maquette ASCII de la fiche :

```
┌─[LIVRE · PDF]──────────────────────────────── SANTÉ ─┐
│ Là où il n'y a pas de docteur                         │
│ Werner, Thuman, Maxwell · Hesperian · éd. fr. 2019    │
│ 639 pages · 12,6 Mo · Licence ouverte Hesperian       │
│                                   [ Installer ]       │
└───────────────────────────────────────────────────────┘
```

### Recherche unifiée

Deux blocs sur la même page `/recherche`. Kiwix et notre index n'ont pas des scores comparables :
mélanger les deux listes donnerait un classement arbitraire.

1. **« Dans les livres »**, en premier et au plus 5 pages (lien « toutes les pages » si plus). Chaque résultat :
   - badge `LIVRE`, icône livre fermé, liseré or à gauche ;
   - **titre du livre, page et chapitre** : « Là où il n'y a pas de docteur · p. 566 · Chapitre 25 : Médicaments » ;
   - extrait avec les mots trouvés en gras ;
   - pour un livre de santé, une petite mention « Vérifiez dans le livre ».
2. **« Dans les encyclopédies »** : les résultats Kiwix actuels, avec un badge `ARTICLE`, sans autre changement.

Le clic ouvre la visionneuse **à la bonne page, les mots cherchés surlignés** (voir section 5).

### Page Bibliothèque

C'est une nouvelle page, `/bibliotheque`, qui liste tout le contenu installé :
- section **Livres** : une fiche d'attribution complète par livre (titre, auteurs, éditeur, édition,
  licence avec lien, texte d'attribution, source, SHA-256 vérifié et date d'installation, lien de soutien) et
  un bouton « Lire » ;
- section **Encyclopédies** : la liste actuelle (titre, description, articles, taille).

Aujourd'hui, la carte d'accueil « Bibliothèque » ouvre l'interface brute de Kiwix. Proposition : elle ouvre
`/bibliotheque`, et Kiwix reste accessible depuis cette page (voir Q2).

### Design

Même thème années 90 : `--biseau`, `--relief` et `--creux`, badges en `--mono`, accent `--or` pour le badge
et le liseré « livre ». L'avertissement santé utilise un encadré en relief creux, jamais une couleur criarde.

## 4. Installation

### Emplacement et volumes

```
/opt/odin/data/livres/
  pas-de-docteur/
    document.pdf          fichier d'origine, non modifié (SHA-256 vérifié)
    pages.json            texte par page, extrait à l'installation (recherche et IA)
    fiche.json            copie des métadonnées du catalogue + sha256 vérifié + date d'installation
  pas-de-docteur.part     pendant le téléchargement seulement
```

- `fiche.json` permet d'afficher l'attribution **même si l'entrée disparaît plus tard du catalogue**.
- Montages ajoutés dans `compose.yml` (`${DATA_DIR}/livres`) :

| Conteneur | Point de montage | Accès | Rôle |
|---|---|---|---|
| dashboard | `/livres` | lecture et écriture | installe, extrait, cherche |
| caddy | `/srv/livres` | lecture seule | sert les PDF (requêtes Range) |
| synchro | `/livres` | lecture seule | indexe pour l'IA |

- **FileBrowser ne le monte pas**. Les livres n'apparaissent donc jamais dans « Documents » et ne peuvent
  pas y être supprimés.

### Déroulé d'une installation (`lib/livres.mjs`)

1. `enLigne()` est faux : refus immédiat avec « Indisponible hors ligne » (même règle que les ZIM et les cartes).
2. Contrôle de l'espace disque : taille du PDF + environ 15 % pour le texte extrait.
3. Pour chaque URL de `sources`, dans l'ordre :
   - téléchargement en `.part` avec reprise (`telechargerFlux` existant), **sans délai d'inactivité**
     (`inactivite: null`), annulation manuelle possible ;
   - **SHA-256 calculé en flux** pendant l'écriture (un `Transform` avec `crypto.createHash`, pas de relecture),
     recalculé sur le fichier entier en cas de reprise ;
   - erreur réseau ou empreinte différente : le `.part` est supprimé et on passe au miroir ; le message
     final dit ce qui a échoué (« source injoignable, miroir : empreinte incorrecte »).
4. Extraction du texte (section 6), puis écriture de `pages.json` et `fiche.json`.
5. Déplacement atomique dans `data/livres/<id>/`. Un livre à moitié installé n'est jamais visible.

Un point à trancher (Q5), celui du délai :
- CLAUDE.md impose un délai à tout appel sortant, avec une seule exception, les cartes ;
- tu demandes « sans délai d'inactivité ». Je propose de garder quand même **un délai de connexion**
  (réponse HTTP attendue 15 s au plus), pour que hors ligne ou source morte, l'échec reste rapide comme le
  veut la règle. Seul le délai d'inactivité pendant le flux est supprimé ;
- CLAUDE.md serait mis à jour pour ajouter les livres à l'exception des cartes.

### Désinstallation

`DELETE /api/livres/<id>` : annule le téléchargement s'il y en a un, sinon supprime `data/livres/<id>/`.
Au cycle suivant, la synchro voit que le livre a disparu et retire ses fichiers de la collection IA. Le cache
de recherche du livre est vidé tout de suite.

## 5. Lecture

### Visionneuse : pdf.js embarqué (recommandé) plutôt que celle du navigateur

| | Visionneuse du navigateur | pdf.js embarqué |
|---|---|---|
| Ouverture à une page (`#page=412`) | Chrome, Edge et Firefox sur ordinateur | Partout |
| **Android** (Chrome) | ❌ télécharge le fichier, pas d'ouverture à la page | ✅ |
| **iPhone / iPad** (Safari) | Affiche, mais ignore `#page=` | ✅ |
| Surlignage des mots cherchés | ❌ | ✅ (`#search=…`) |
| Hors ligne, sans CDN | ✅ | ✅ si l'archive est embarquée dans l'image |
| Coût | 0 | Environ 7 Mo dans l'image, 1 dépendance |

Sur le terrain, beaucoup de lecteurs auront un téléphone : la visionneuse du navigateur rendrait le lien
« p. 566 » inutilisable sur Android.

Mise en œuvre :
- **Visionneuse** : l'archive officielle `pdfjs-5.6.205-dist.zip` (6,8 Mo, versions de mozilla/pdf.js sur
  GitHub) est téléchargée **au build de l'image**, avec empreinte vérifiée et version figée, comme les
  ressources de la carte (`basemaps-assets`). Elle est copiée dans `public/pdfjs/`. Aucun CDN, aucune requête
  extérieure à l'exécution.
- **Fichiers** : Caddy sert `data/livres/*/document.pdf` sur `/livres-fichiers/*`, avec requêtes Range et derrière
  `forward_auth`, comme `/tuiles/*`. Le PDF étant linéarisé, la première page s'affiche avant la fin du chargement.
- **Page `/livres/<id>?page=412&q=paracetamol`** :
  - en haut, une barre ODIN (accueil, titre du livre, page, lien vers la fiche d'attribution) ;
  - pour un livre de santé, un bandeau fixe : « Guide de santé : en cas de doute, consultez un soignant.
    Vérifiez toujours les doses dans le livre. » ;
  - en dessous, un cadre sur `/pdfjs/web/viewer.html?file=/livres-fichiers/<id>/document.pdf#page=412&search=paracetamol`.
- **Liens externes dans le PDF** : pdf.js les ouvre dans un nouvel onglet. Hors ligne, ils échouent comme
  n'importe quel lien. On ne peut pas les griser comme dans le lecteur ZIM. Option : les désactiver hors ligne
  par une option de pdf.js (Q8).
- pdf.js a eu une faille grave (CVE-2024-4367), corrigée depuis la 4.2.67. La version 5.6.205 n'est pas concernée.

## 6. Recherche

### Extraction : pdf.js dans le conteneur dashboard, à l'installation

- La même dépendance sert à la visionneuse (archive) et à l'extraction (`pdfjs-dist` 5.6.205, version
  Node, dans `package.json`) : pas de poppler ni de nouveau conteneur.
- L'extraction tourne dans un **processus enfant** (`node scripts/extraire-texte.mjs`), comme `pmtiles` pour
  les cartes. Deux raisons :
  - le pic de mémoire (220 Mo) ne gonfle pas durablement le serveur Next ;
  - Next ne regroupe pas pdf.js dans son bundle, ce qui éviterait le piège vécu avec MapLibre
    (`outputFileTracingIncludes` à prévoir).
- Sortie `pages.json` : `[{ "page": 1, "chapitre": null, "texte": "…" }, …]`. Le chapitre est déduit de
  l'en-tête courant « NNN Chapitre X : titre » et propagé aux pages impaires.
- **Livres déjà installés** : si `pages.json` manque (ancienne version, extraction interrompue), elle est
  relancée au démarrage.

### Index et requête : dans le dashboard, sans moteur externe

- Au premier usage, les `pages.json` de tous les livres sont chargés en mémoire, texte normalisé (minuscules,
  accents retirés, apostrophes unifiées). Mesuré : **19 Mo et 27 ms** pour ce livre.
- Requête : tous les mots doivent être présents (comme Kiwix). Score = nombre d'occurrences, avec un bonus si
  la phrase exacte est présente et si le mot est dans le titre du chapitre. **1 à 3 ms** pour 639 pages.
- Extrait : environ 250 caractères autour de la première occurrence, mots en gras, HTML échappé (même
  fonction que `recherche.mjs`).
- **Coût machine** :
  - à l'installation : environ 5 s de CPU et 220 Mo de mémoire pendant ces quelques secondes ;
  - à l'usage : environ 20 Mo de mémoire par livre de cette taille, et quelques millisecondes par recherche ;
  - cette approche tient jusqu'à quelques dizaines de livres. Au-delà, SQLite FTS5 (fourni avec Node 22)
    serait l'étape suivante (voir Q7 sur Node).
- Solution écartée : convertir le PDF en ZIM pour profiter de l'index Kiwix. Il faudrait un outil
  d'écriture ZIM dans l'image, et on perdrait le PDF original et sa mise en page.

## 7. IA

### Une collection séparée, en lecture seule côté ODIN

- La synchro gagne une 2ᵉ source : `/livres`, en lecture seule. Elle alimente une collection **« Livres ODIN »**
  distincte de « Mes documents », avec un état séparé (`data/synchro/livres.json`). Variante : une
  collection par livre, par exemple « Livre : Là où il n'y a pas de docteur », ce qui permet de n'en
  sélectionner qu'un dans une conversation (Q6).
- **La synchro n'envoie pas le PDF entier** mais une **page par fichier texte**, nommé
  « Là où il n'y a pas de docteur — p. 566 (Chapitre 25 Médicaments) ». Chaque morceau indexé porte donc sa
  page, et la citation affichée par Open WebUI la montre, quelle que soit la façon dont Open WebUI découpe
  les PDF. Je n'ai pas pu vérifier que son lecteur PDF garde le numéro de page dans les citations ; cette
  méthode ne dépend pas de lui.
  - Coût : 639 fichiers d'environ 2 200 caractères, 1,42 million de caractères à vectoriser avec bge-m3 sur
    CPU. **Une seule fois**, à l'installation ; durée à mesurer sur nomad (estimation : de 10 à 30 minutes).
    La synchro fait déjà ce travail en tâche de fond.
- **« Non supprimable depuis FileBrowser »** : c'est acquis, puisque FileBrowser ne voit pas `data/livres`.
  **Limite honnête :** avec `WEBUI_AUTH=false`, tout le monde est administrateur d'Open WebUI. On peut y
  supprimer la collection ou un fichier. La synchro les **recrée au cycle suivant**. C'est de
  l'auto-réparation, pas une vraie lecture seule, et Open WebUI ne propose rien de mieux sans comptes.

### Contenu médical : citer, et avertir

Trois mécanismes, que la synchro met en place par l'API. Les variables d'environnement d'Open WebUI sont figées
après le premier démarrage (piège connu), d'où l'usage de l'API, comme pour `masquerModeles`.

1. **Un modèle préréglé « Assistant santé »** :
   - basé sur `qwen2.5:3b`, créé par `/api/v1/models/create` ;
   - la collection du livre y est attachée ;
   - un message système impose :
     - de répondre uniquement à partir du livre ;
     - de **citer le titre et la page** à chaque affirmation (« [Là où il n'y a pas de docteur, p. 566] ») ;
     - de dire « je ne trouve pas cela dans le livre » plutôt que d'inventer ;
     - de rappeler la vérification dans le livre à la fin de toute réponse qui parle de médicament ou de dose.
2. **Un bandeau global permanent** (`POST /api/v1/configs/banners`, type `warning`, non masquable) :
   « Assistant local, il peut se tromper. Pour la santé, vérifiez toujours dans le livre la page citée,
   surtout les doses de médicaments. » Cette route existe dans la version figée d'Open WebUI (vérifié sur nomad).
3. **Dans ODIN** : chaque citation « p. 566 » visible dans la recherche ou la bibliothèque est un lien direct
   vers la visionneuse à cette page. Le bandeau santé du lecteur répète l'avertissement.

**Limite importante :** `qwen2.5:3b` est un petit modèle. Même avec ces consignes, il peut mal recopier une dose.
Je propose que le message système **lui interdise de donner une dose chiffrée** : il indique la page où la
trouver, et on lit la dose dans le livre (Q9).

## 8. Impact

### Fichiers touchés

| Fichier | Changement |
|---|---|
| `catalogue/documents.json` | **nouveau** |
| `dashboard/lib/livres.mjs` | **nouveau** : catalogue, installation (SHA-256, miroir), désinstallation, index, recherche |
| `dashboard/scripts/extraire-texte.mjs` | **nouveau** : extraction pdf.js en processus enfant |
| `dashboard/lib/telechargements.mjs` | `telechargerFlux` accepte un transform supplémentaire (empreinte) et un délai de connexion séparé |
| `dashboard/app/api/livres/route.js`, `api/livres/[id]/route.js` | **nouveaux** : liste, installer, annuler, désinstaller |
| `dashboard/app/Livres.jsx`, `configuration/page.jsx` | panneau « Livres » |
| `dashboard/app/livres/[id]/page.jsx` | **nouveau** : barre ODIN + visionneuse |
| `dashboard/app/bibliotheque/page.jsx` | **nouveau** : fiches d'attribution |
| `dashboard/lib/recherche.mjs`, `app/recherche/page.jsx` | bloc « Dans les livres », badges |
| `dashboard/lib/etat.mjs`, `app/page.jsx` | carte Bibliothèque vers `/bibliotheque` (si Q2 est validée) |
| `dashboard/app/globals.css` | badges, fiche, bandeau santé |
| `dashboard/package.json`, `Dockerfile`, `next.config.mjs` | `pdfjs-dist` 5.6.205, archive de la visionneuse figée et vérifiée, traçage des fichiers |
| `Caddyfile` | route `/livres-fichiers/*` (déjà redémarré par l'installeur quand il change) |
| `compose.yml` | 3 montages `${DATA_DIR}/livres`, variables de la synchro |
| `synchro/synchro.mjs` | 2ᵉ source et collection, modèle « Assistant santé », bandeau |
| `install.sh` | **une ligne** : `data/livres` ajouté au `mkdir -p` |
| `CLAUDE.md`, `README.md` | architecture, exception de délai, dépendance pdf.js, vocabulaire |

### install.sh et test sur VM vierge

Le seul changement est la création de `data/livres` à côté des autres dossiers. Sans lui, Docker créerait
le dossier appartenant à root au premier `up`. Il n'y a rien à ajouter à la liste des services redémarrés :
Caddyfile et `synchro/` y sont déjà. **Ce changement impose le test sur VM vierge** (installation avec
`BRANCHE=dev`), suivi du **test hors ligne** : panneau Livres grisé, recherche, visionneuse et IA fonctionnels,
journal sans tentative inattendue.

Option d'installation par défaut du livre Hesperian, comme le fond de carte (Q10) : ce serait un 2ᵉ changement
d'`install.sh`, dans le même test.

### Découpage en étapes testables sur nomad (branche dev)

Chaque étape est commitée sur dev, testée sur nomad par toi dans le navigateur, puis validée avant la suivante.

| # | Étape | Ce que tu testes sur nomad |
|---|---|---|
| 1 | Catalogue, installation, désinstallation : `documents.json`, `lib/livres.mjs`, API, panneau « Livres » | Installer Hesperian (progression, taille connue d'avance), vérifier `fiche.json`, désinstaller. Mode manuel hors ligne : bouton grisé. Test d'empreinte fausse sur une entrée de test temporaire : échec et message clair. |
| 2 | Lecture : archive pdf.js, route Caddy, page `/livres/<id>` | Ouvrir à la page 566, sur PC et téléphone ; onglet Réseau : aucune requête vers un autre hôte. |
| 3 | Extraction et recherche unifiée | « paracétamol » : bloc Livres avec page et chapitre, le clic ouvre la bonne page surlignée ; résultats ZIM inchangés. |
| 4 | Page Bibliothèque et carte d'accueil | Fiche d'attribution complète, liens licence et soutien (grisés hors ligne). |
| 5 | IA : collection, modèle « Assistant santé », bandeau | Durée d'indexation mesurée ; question sur la diarrhée de l'enfant : pages citées, pas de dose inventée, bandeau visible. |
| 6 | `install.sh`, test sur VM vierge et test hors ligne, CLAUDE.md et README | Protocole complet de CLAUDE.md. Fusion dans main ensuite. |

L'étape 1 ne dépend pas d'`install.sh` sur nomad : Docker crée `data/livres` au premier `up`. Le changement
d'`install.sh` et son test sont regroupés à l'étape 6, pour ne faire qu'un seul test sur VM vierge.

## 9. Questions à trancher

| # | Question | Ma recommandation |
|---|---|---|
| Q1 | Vocabulaire « Livre » (et non « Document », déjà pris par les fichiers personnels) ? Nom du fichier catalogue : `documents.json` ou `livres.json` ? | « Livre » partout, `livres.json` |
| Q2 | Le panneau « Bibliothèque » de Configuration devient « Encyclopédies » ; la carte d'accueil « Bibliothèque » ouvre la nouvelle page `/bibliotheque` au lieu de l'interface Kiwix ? | Oui |
| Q3 | **Miroir de secours** : lequel ? Un fichier joint à une version GitHub (release) du dépôt ODIN est gratuit et stable, mais c'est une **redistribution** : à vérifier dans la licence Hesperian. Ou une autre URL officielle d'Hesperian, que je n'ai pas trouvée et que je n'invente pas. | Release GitHub si la licence l'autorise, sinon pas de miroir |
| Q4 | URL exacte des **conditions de licence** et de la **page de dons ou du site d'Hesperian** à mettre dans le catalogue | À fournir par toi (je n'invente pas d'URL) |
| Q5 | Délai : supprimer l'inactivité mais **garder un délai de connexion de 15 s**, et ajouter les livres à l'exception de CLAUDE.md ? Tu mentionnes « l'audit hors ligne en cours » : je n'en ai pas trace dans le dépôt ; si une règle a changé, dis-la-moi. | Oui au délai de connexion |
| Q6 | IA : une collection « Livres ODIN » commune, ou **une collection par livre** ? | Une par livre (liée au modèle « Assistant santé ») |
| Q7 | Nouvelle dépendance **pdf.js** (CLAUDE.md dit « rien d'autre » que Next, React et la carte) : acceptée ? Au passage, **Node 20 est en fin de vie depuis avril 2026**. Monter l'image du dashboard en Node 22 ou 24 (sujet à part) permettrait la dernière version de pdf.js et SQLite intégré. | pdf.js 5.6.205 accepté ; Node 22 dans un chantier séparé |
| Q8 | Liens externes à l'intérieur des PDF : les laisser (échec normal hors ligne) ou les désactiver quand ODIN est hors ligne ? | Les laisser, suivre plus tard |
| Q9 | **Doses** : l'assistant a-t-il le droit de donner une dose chiffrée, ou seulement la page où la lire ? | Seulement la page |
| Q10 | Installer Hesperian **par défaut** avec ODIN (13 Mo), comme le fond de carte ? | Oui, c'est le contenu le plus utile hors ligne pour son poids |
| Q11 | Désinstallation des **packs ZIM**, qui n'existe pas aujourd'hui : on l'ajoute dans ce chantier, par cohérence ? | Chantier séparé, petit |

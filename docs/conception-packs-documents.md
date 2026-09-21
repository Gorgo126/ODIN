# Packs « livre » (PDF) : conception

Statut : **conception relue, décisions intégrées (v2, 21/09/2026). Rien n'est codé.**
L'implémentation démarre après ta validation de cette version.
Premier cas réel : *Là où il n'y a pas de docteur* (Hesperian, édition française 2019).

## Décisions prises

| # | Sujet | Décision |
|---|---|---|
| Q1 | Vocabulaire | **« Livre »** dans l'interface, `livre` dans le code, catalogue `catalogue/livres.json`. « Documents » reste réservé aux fichiers personnels. |
| Q2 | Accueil | **La carte « Bibliothèque » ne change pas.** Une **nouvelle carte d'accueil « Livres »** ouvre `/livres`. |
| Q3 | Miroir de secours | Une **release GitHub unique, dédiée aux livres, tag `livres-v1`**, sans lien avec les versions d'ODIN. ⚠️ Autorisation Hesperian nécessaire avant publication (section 10). |
| Q4 | Licence, dons, site | Voir la fiche du livre (section 2). ⚠️ L'URL des conditions fournie ne répond plus (section 10). |
| Q5 | Délais | **Plus de délai d'inactivité ; 15 s au plus pour obtenir la réponse HTTP.** CLAUDE.md est mis à jour : les livres rejoignent l'exception des cartes. |
| Q6 | IA | **Une collection Open WebUI par livre.** |
| Q7 | pdf.js | **Visualiseur précompilé, servi en fichiers statiques** par le dashboard, indépendant de Node (section 5). Node 20 en fin de vie : **dette connue**, chantier séparé (section 9). |
| Q8 | Liens externes dans les PDF | Laissés tels quels (ils échouent normalement hors ligne). À revoir plus tard. |
| Q9 | Doses | **L'assistant ne donne jamais de dose chiffrée**, seulement le titre et la page où la lire, avec le bandeau d'avertissement. |
| Q10 | Installation par défaut | **« Là où il n'y a pas de docteur » installé par défaut** par `install.sh`. Les autres livres restent optionnels. |
| Q11 | Désinstallation des packs ZIM | Chantier séparé. |

## 0. Existant et mesures

### Ce qui existe aujourd'hui

| Brique | Fonctionnement actuel | Conséquence pour les livres |
|---|---|---|
| Catalogue | `catalogue/packs.txt`, 18 lignes `id\|nom kiwix\|variante\|libellé`. Titre, taille et URL viennent de l'OPDS Kiwix, en ligne (`lib/catalogue.mjs`). | Un PDF n'a pas d'OPDS : **toutes** ses métadonnées sont dans notre catalogue. |
| Installation | `lib/telechargements.mjs` : `demarrer(id)` passe par `enLigne()`, vérifie l'espace disque, télécharge en `.part` avec reprise (`telechargerFlux`), renomme, puis inscrit le livre dans `library.xml`. | Mécanique réutilisée ; on y ajoute l'empreinte et le miroir. |
| Désinstallation | Aucune pour les ZIM (le `DELETE` annule seulement un téléchargement) ; les cartes se suppriment (`supprimer()` dans `lib/cartes.mjs`). | Le livre a une vraie désinstallation, calquée sur les cartes. |
| Recherche unifiée | `/recherche` n'interroge que `kiwix-serve` (`/kiwix/search`), 20 résultats par page. | Kiwix n'indexe pas les PDF : il faut notre propre index, affiché à part. |
| Lecteur | `/lire/...` : HTML de Kiwix nettoyé, liens externes grisés hors ligne. | Visionneuse PDF dédiée. |
| Synchro | `data/documents` (lecture seule) vers une collection « Mes documents » ; crée déjà des modèles par l'API (`masquerModeles`). | 2ᵉ source, une collection par livre. |
| Caddy | `/tuiles/*` en `file_server` (requêtes Range), derrière `forward_auth`. | Même modèle pour servir les PDF. |

### Mesures sur *Là où il n'y a pas de docteur* (dans la zone temporaire, pas dans le dépôt)

- `https://dokotoro.org/wp-content/uploads/2020/07/French-Edition.pdf` : HTTP 200, `application/pdf`,
  **13 178 244 octets**, requêtes Range acceptées, `Last-Modified: 29/07/2020`.
- **SHA-256 `6f27a90a8e6fb134a624b477a822cd135a1a18e2bad7cc8118e7d5aba6e4c404`**
- PDF 1.6 linéarisé, **639 pages**. Copyright 2019, ISBN 978-1-942919-55-1 (page 2).
- **Texte présent et propre, accents compris, pas d'OCR nécessaire** : 1,42 million de caractères, 6 pages quasi vides.
- **Pages imprimées et pages du PDF identiques** : la page 200 du PDF commence par « 200 Chapitre 11 : … ».
- Chaque page paire porte un en-tête courant « NNN Chapitre X : titre », ce qui permet de déduire le chapitre.
  Le chapitre 25 « Médicaments » couvre environ les pages 514 à 600.
- Extraction avec pdf.js 5.6.205 sous Node 20 : 4,4 s, 220 Mo au pic, texte par page 1,6 Mo.
- Recherche naïve en mémoire : 1 à 3 ms par requête, 19 Mo.

## 1. Vocabulaire

| Terme | Sens | Où on le voit |
|---|---|---|
| **Pack** | Tout ce qui s'installe depuis le catalogue (terme générique, surtout interne) | Configuration |
| **Encyclopédie** | Pack ZIM ; ses résultats sont des **articles** | Recherche (badge) |
| **Livre** | Pack PDF ; ses résultats sont des **pages** | Catalogue, recherche, `/livres` |
| **Documents** | Fichiers personnels, inchangé | FileBrowser, IA |
| **Bibliothèque** | Inchangé : carte d'accueil vers Kiwix, panneau ZIM de Configuration | Inchangé |

Le type technique reste `pdf` dans le catalogue, pour accueillir plus tard un autre format.

## 2. Catalogue : `catalogue/livres.json`

Fichier séparé :
- `packs.txt`, `lirePacks()` et les 18 packs ZIM restent **intacts** ;
- JSON parce qu'il y a une douzaine de champs, dont des URL et une phrase d'attribution ; Node le lit sans dépendance.

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
    "annee": 2019,
    "isbn": "978-1-942919-55-1",
    "langue": "fra",
    "categorie": "sante",
    "pages": 639,
    "licence": {
      "nom": "Licence ouverte Hesperian (Open Copyright)",
      "url": "https://hesperian.org/open-copyright-policy/",
      "conditions": "Usage non lucratif, attribution obligatoire, fichier non modifié"
    },
    "attribution": "David Werner, Carol Thuman, Jane Maxwell, Hesperian Health Guides.",
    "credit": "Édition française adaptée avec Dokotoro et ENDA-Tiers Monde.",
    "sources": [
      "https://dokotoro.org/wp-content/uploads/2020/07/French-Edition.pdf",
      "https://github.com/Gorgo126/ODIN/releases/download/livres-v1/pas-de-docteur.pdf"
    ],
    "sha256": "6f27a90a8e6fb134a624b477a822cd135a1a18e2bad7cc8118e7d5aba6e4c404",
    "taille": 13178244,
    "dons": "https://donate.hesperian.org/",
    "site": "https://hesperian.org",
    "avertissement": "sante",
    "parDefaut": true,
    "description": "Guide de santé de référence pour les soins de base, là où les services médicaux manquent."
  }
]
```

Remarques :
- **`licence.url`** : j'ai mis `https://hesperian.org/open-copyright-policy/` et non
  `https://www.hesperian.org/about/opencopyright`, qui renvoie une erreur 404. Hesperian redirige
  lui-même `/about/open-copyright/` vers cette page (section 10).
- **Miroir** : l'URL suit la forme standard des fichiers de release GitHub. La release `livres-v1` **n'existe pas
  encore** : elle sera créée à l'étape 1, après l'accord d'Hesperian (section 10).
- **Taille et SHA-256 sont fixés dans le catalogue**. La taille s'affiche donc hors ligne sans mesure préalable.
- `langue` suit ISO 639-3 (`fra`), comme Kiwix. `categorie` prend ses valeurs dans une liste courte
  (sante, eau, energie, agriculture, technique…).
- `sources` est ordonné : source officielle, puis miroir.
- `avertissement: "sante"` déclenche les avertissements médicaux. `parDefaut: true` marque le livre installé
  par `install.sh`.
- Une entrée invalide (champ manquant, SHA-256 mal formé) est écartée avec un message dans les logs,
  **sans faire tomber la page Configuration**.

## 3. Différenciation avec les packs ZIM

### Configuration : panneau « Livres »

C'est un panneau `Panneau` séparé, placé sous « Bibliothèque », qui reste inchangé. Il comporte :
- **une icône propre** : un livre fermé avec un signet (le livre ouvert reste pour la Bibliothèque ZIM) ;
- **un badge `LIVRE · PDF`** en `--mono`, bordure or ;
- **une fiche par livre** : titre, auteurs, édition, nombre de pages, taille (connue hors ligne), licence ;
  bouton Installer, Annuler ou Désinstaller ; état de l'indexation IA (section 7).

```
┌─[LIVRE · PDF]──────────────────────────────── SANTÉ ─┐
│ Là où il n'y a pas de docteur                         │
│ Werner, Thuman, Maxwell · Hesperian · éd. fr. 2019    │
│ 639 pages · 12,6 Mo · Licence ouverte Hesperian       │
│ Assistant IA : indexé (639/639 pages)                 │
│                                   [ Désinstaller ]    │
└───────────────────────────────────────────────────────┘
```

### Accueil : nouvelle carte « Livres »

Elle rejoint les services, à côté de Bibliothèque, Documents, Assistant IA et Carte, et ouvre `/livres`.
Son état « Online » est affiché dès qu'un livre est installé (même logique que la carte Carte). Sa description :
« Livres de référence en PDF, lisibles hors ligne, avec recherche page par page. »

### Page `/livres`

- Une **fiche d'attribution complète** par livre :
  - titre, auteurs, éditeur, édition et ISBN ;
  - **licence avec lien vers les conditions**, attribution et crédit (« Édition française adaptée avec Dokotoro
    et ENDA-Tiers Monde ») ;
  - source et SHA-256 vérifié, avec la date d'installation ;
  - liens **« Soutenir Hesperian »** (dons) et **« Site de l'éditeur »**, grisés hors ligne avec « Indisponible hors ligne ».
- Un bouton **« Lire »** qui ouvre la visionneuse à la page 1.
- Pour un livre de santé, l'encadré d'avertissement (section 5).

### Recherche unifiée

Kiwix et notre index n'ont pas des scores comparables. La page `/recherche` montre donc deux blocs :

1. **« Dans les livres »**, en premier, au plus 5 pages, puis un lien « toutes les pages ». Chaque résultat affiche :
   - badge `LIVRE`, icône livre fermé, liseré or ;
   - **titre du livre, page et chapitre** : « Là où il n'y a pas de docteur · p. 566 · Chapitre 25 : Médicaments » ;
   - extrait avec les mots en gras ;
   - pour un livre de santé, la mention « Vérifiez dans le livre ».
2. **« Dans les encyclopédies »** : les résultats Kiwix actuels, avec un badge `ARTICLE`, sans autre changement.

Le clic sur un résultat « livre » ouvre la visionneuse **à la bonne page, avec les mots cherchés surlignés**.

### Design

Même thème années 90 : `--biseau`, `--relief` et `--creux`, badges en `--mono`, accent `--or` pour le badge et le
liseré. L'avertissement santé est un encadré en relief creux, jamais une couleur criarde.

## 4. Installation

### Emplacement et volumes

```
/opt/odin/data/livres/
  pas-de-docteur/
    document.pdf     fichier d'origine, non modifié, SHA-256 vérifié
    pages.json       texte par page, extrait à l'installation (recherche et IA)
    fiche.json       copie de l'entrée du catalogue + empreinte vérifiée + source utilisée + date
  .en-cours/         téléchargements et extractions en cours, jamais visibles comme installés
```

`fiche.json` garde l'attribution affichable même si l'entrée disparaît du catalogue.

| Conteneur | Montage | Accès | Rôle |
|---|---|---|---|
| dashboard | `${DATA_DIR}/livres:/livres` | lecture et écriture | installe, extrait, cherche |
| dashboard | `${DATA_DIR}/synchro:/synchro` | lecture seule | lit la progression de l'indexation IA |
| caddy | `${DATA_DIR}/livres:/srv/livres` | lecture seule | sert les PDF (requêtes Range) |
| synchro | `${DATA_DIR}/livres:/livres` | lecture seule | indexe pour l'IA |

**FileBrowser ne monte pas `data/livres`** : les livres n'apparaissent pas dans « Documents » et ne peuvent pas y être supprimés.

### Déroulé

1. `enLigne()` est faux : refus immédiat avec « Indisponible hors ligne ».
2. Contrôle de l'espace disque : taille du PDF + 15 % pour le texte extrait.
3. Pour chaque URL de `sources`, dans l'ordre :
   - téléchargement dans `.en-cours/<id>.part`, avec reprise (`telechargerFlux` existant) ;
   - **aucun délai d'inactivité** pendant le flux, mais **15 s au plus pour obtenir la réponse HTTP**. Hors ligne ou
     source morte, l'échec est donc rapide. L'annulation reste manuelle ;
   - à la fin, **SHA-256 calculé sur le fichier complet** (13 Mo se relisent en une fraction de seconde, et la
     reprise n'a pas besoin d'un cas particulier) ;
   - l'empreinte est comparée à celle du catalogue (voir ci-dessous).
4. Extraction du texte (section 6), puis écriture de `pages.json` et `fiche.json`.
5. Déplacement atomique de `.en-cours/<id>/` vers `data/livres/<id>/`.

### Empreinte différente : la règle

**Un fichier dont l'empreinte ne correspond pas n'est jamais installé, ni lu, ni indexé.**

| Situation | Comportement |
|---|---|
| Source : empreinte correcte | Installation normale. `fiche.json` indique « source : officielle ». |
| Source : **empreinte différente** (l'éditeur a remplacé le fichier, ou il a été corrompu en route) | Le fichier téléchargé est **supprimé aussitôt** et le log indique les deux empreintes. On passe au miroir. |
| Source injoignable (erreur réseau, HTTP ≠ 200 ou 206, pas de réponse en 15 s) | On passe au miroir. |
| Miroir : empreinte correcte | Installation normale. `fiche.json` indique « source : miroir ODIN ». |
| Miroir : empreinte différente, ou injoignable | **Échec**, rien n'est installé, aucun fichier ne reste sur le disque. |

Messages d'échec (affichés dans le panneau, sous le bouton « Réessayer ») :
- Les deux empreintes diffèrent : « Le fichier publié par l'éditeur a changé et ne correspond plus au catalogue
  d'ODIN ; le miroir non plus. Installation refusée par sécurité. Une mise à jour d'ODIN est nécessaire. »
- Source modifiée, miroir injoignable : « Le fichier publié par l'éditeur a changé et le miroir d'ODIN est
  injoignable. Installation refusée par sécurité. »
- Les deux injoignables : « Source et miroir injoignables. Vérifiez l'accès à internet, puis réessayez. »

Un `.part` dont la reprise a produit une empreinte fausse est supprimé : le « Réessayer » suivant repart de zéro,
ce qui évite de reprendre un fichier corrompu.

Quand l'éditeur publie une nouvelle version, on met à jour l'entrée du catalogue (nouvelle empreinte, nouvelle
taille) et on dépose le nouveau fichier dans une nouvelle release (`livres-v2`). Un livre installé n'est jamais
remplacé en silence.

### Désinstallation

`DELETE /api/livres/<id>` : annule le téléchargement s'il y en a un, sinon supprime `data/livres/<id>/`.
Au cycle suivant, la synchro retire la collection du livre dans Open WebUI. Le cache de recherche est vidé tout de suite.
Le livre installé par défaut peut aussi être désinstallé (contrairement au fond de carte) : ce n'est qu'un contenu.

### Installation par défaut (`install.sh`)

Même mécanisme que le fond de carte : après le démarrage des services, `install.sh` demande au dashboard
d'installer les livres `parDefaut` (`POST /api/livres/pas-de-docteur`) et attend la fin. En cas d'échec
(hors ligne, empreinte), il affiche une ligne d'avertissement sans bloquer l'installation : « Livre non installé :
ajoutez-le depuis Configuration, section Livres. » Déjà installé : rien à faire (mise à jour d'ODIN).

## 5. Lecture

### Visualiseur pdf.js précompilé, en fichiers statiques (décision Q7)

- **C'est possible.** Mozilla publie avec chaque version une archive de visualiseur **déjà compilée**
  (`pdfjs-<version>-dist.zip`, et une variante `legacy` pour les navigateurs anciens) :
  - `web/viewer.html`, `viewer.mjs`, `viewer.css`, les images ;
  - `build/pdf.mjs` et `pdf.worker.mjs` ;
  - les polices standard et les tables de caractères (`cmaps`) ;
  - le tout en fichiers statiques pour le **navigateur**.
- Le **dashboard les sert tels quels** depuis `public/pdfjs/`. Next ne les compile pas, et **Node n'exécute rien** :
  la version de Node du serveur n'a aucun effet, et la contrainte « pdf.js ≤ 5.6 sous Node 20 » disparaît pour
  le visualiseur. On choisit la version de pdf.js pour les navigateurs des lecteurs, pas pour le serveur.
- **Aucune dépendance npm** : l'archive est téléchargée **au build de l'image**, avec URL, version et SHA-256 figés
  dans le `Dockerfile`, puis décompressée dans `public/pdfjs/`. C'est la méthode déjà utilisée pour
  `basemaps-assets`. Rien n'est téléchargé à l'exécution, aucun CDN.
- Choix de l'archive : la **`legacy`**, qui fonctionne aussi sur les téléphones et navigateurs anciens, fréquents
  sur le terrain. La version exacte et son empreinte seront figées à l'étape 2. Par exemple 5.6.205 : 7,1 Mo en
  `legacy`, 6,8 Mo en standard, publiée le 29/03/2026.
- Le visualiseur a eu une faille grave (CVE-2024-4367), corrigée depuis la 4.2.67. On prend une version récente, et
  sa mise à jour suit la règle des images figées : volontaire, testée sur nomad puis hors ligne.

### Pourquoi pas la visionneuse du navigateur

| | Navigateur | pdf.js embarqué |
|---|---|---|
| Ouverture à une page (`#page=412`) | Chrome, Edge et Firefox sur ordinateur | Partout |
| Android (Chrome) | ❌ télécharge le fichier | ✅ |
| iPhone / iPad | Affiche, mais ignore `#page=` | ✅ |
| Surlignage des mots cherchés | ❌ | ✅ (`#search=…`) |

### Page `/livres/<id>?page=412&q=paracetamol`

- **Barre ODIN** en haut : accueil, titre du livre, page, lien vers la fiche d'attribution.
- Pour un livre de santé, un **bandeau fixe** : « Guide de santé : en cas de doute, consultez un soignant.
  Vérifiez toujours les doses de médicaments dans le livre. »
- En dessous, un cadre sur `/pdfjs/web/viewer.html?file=/livres-fichiers/<id>/document.pdf#page=412&search=paracetamol`.
- **Fichiers** : Caddy sert `data/livres/*/document.pdf` sur `/livres-fichiers/*`, avec requêtes Range et derrière
  `forward_auth`, comme `/tuiles/*`. Le PDF étant linéarisé, la première page s'affiche avant la fin du chargement.
- `viewer.html` n'accepte que des fichiers de la même origine (comportement par défaut de pdf.js). On n'ouvre donc
  pas de PDF extérieur par ce chemin.

## 6. Recherche

### Extraction : `pdftotext` (poppler) dans l'image du dashboard

Avec le visualiseur en fichiers statiques, l'extraction ne doit pas non plus dépendre de la version de Node.
Deux possibilités :

| | `pdftotext` (poppler-utils, paquet Alpine) | `pdfjs-dist` en Node |
|---|---|---|
| Dépend de Node | Non | Oui (≤ 5.6.205 sous Node 20) |
| Dépendance npm | Aucune | Une |
| Taille dans l'image | Environ 15 à 20 Mo avec ses bibliothèques (poppler 25.12 : 2,8 Mo, outils : 0,6 Mo, plus nss, freetype, lcms2, openjpeg, tiff…), à mesurer au build | Environ 35 Mo dans `node_modules` |
| Vitesse | Plus rapide (natif) | Mesurée : 4,4 s pour 639 pages |
| Qualité sur ce livre | **À vérifier à l'étape 3** | Mesurée : propre, accents compris |

**Recommandation : `pdftotext`.** Il est lancé en processus enfant, comme `pmtiles` :
`pdftotext -enc UTF-8 document.pdf -`, les pages séparées par des sauts de page. Si l'étape 3 montre un texte
moins bon que pdf.js (ordre des colonnes, césures), on revient à `pdfjs-dist` 5.6.205 pour l'extraction seulement.
On garderait alors une dépendance liée à Node, ce qui est une raison de plus pour le chantier Node.

Format de `pages.json` : `[{ "page": 1, "chapitre": null, "texte": "…" }, …]`. Le chapitre est tiré de l'en-tête
courant et propagé aux pages impaires. Si `pages.json` manque (extraction interrompue), elle est relancée au démarrage.

### Index et requête : en mémoire dans le dashboard

- Les `pages.json` sont chargés au premier usage, texte normalisé (minuscules, sans accents, apostrophes unifiées) :
  19 Mo et 27 ms pour ce livre.
- Tous les mots doivent être présents (comme Kiwix). Score = nombre d'occurrences, avec un bonus pour la phrase exacte
  et pour les mots du titre de chapitre. 1 à 3 ms pour 639 pages.
- Extrait d'environ 250 caractères, mots en gras, HTML échappé.
- **Coût** :
  - à l'installation, quelques secondes de CPU ;
  - à l'usage, environ 20 Mo de mémoire par livre de cette taille.
  - Cela tient jusqu'à quelques dizaines de livres. Au-delà, SQLite FTS5 (fourni avec Node 22) serait l'étape suivante.

## 7. IA

### Une collection par livre, en lecture seule côté ODIN

- La synchro gagne une 2ᵉ source, `/livres` (lecture seule) : **une collection Open WebUI par livre**, par
  exemple « Livre : Là où il n'y a pas de docteur ». Son état est séparé (`data/synchro/livres.json`).
- Elle envoie **une page par fichier texte**, nommé « Là où il n'y a pas de docteur — p. 566 (Chapitre 25 Médicaments) ».
  Chaque morceau indexé porte sa page, et la citation d'Open WebUI la montre, sans dépendre de son lecteur PDF.
- **FileBrowser** ne voit pas `data/livres`.
- **Limite :** avec `WEBUI_AUTH=false`, tout le monde est administrateur d'Open WebUI et peut supprimer la collection.
  La synchro la recrée au cycle suivant. C'est de l'auto-réparation, pas une vraie lecture seule.

### Progression et durée de l'indexation

- La synchro écrit sa progression dans `data/synchro/livres.json` après chaque page :
  `{ "pas-de-docteur": { "fait": 212, "total": 639, "debut": …, "fin": null, "erreurs": 0 } }`.
- Le dashboard la lit (montage en lecture seule) et l'affiche :
  - sur la fiche du panneau Livres : « Assistant IA : indexation 212/639 pages, environ 14 min restantes » ;
  - sur `/livres` : « Assistant IA : pas encore disponible pour ce livre », tant que l'indexation n'est pas finie.
- **Mesure prévue à l'étape 5 sur nomad** :
  - durée totale des 639 pages avec bge-m3 ;
  - pages par minute ;
  - charge CPU et mémoire d'Ollama pendant l'indexation ;
  - effet sur l'utilisation du chat pendant ce temps.
  Estimation actuelle : de 10 à 30 minutes. Les chiffres réels remplaceront l'estimation dans ce document et
  dans le README.

### Contenu médical : citer, ne jamais donner de dose

La synchro met tout en place par l'API. Les variables d'environnement d'Open WebUI sont figées après le premier
démarrage (piège connu), d'où l'usage de l'API.

1. **Modèle préréglé « Assistant santé »** (`/api/v1/models/create`), basé sur `qwen2.5:3b`, avec la collection
   du livre attachée. Le message système impose :
   - de répondre uniquement à partir du livre ;
   - de **citer le titre et la page** à chaque affirmation : « (Là où il n'y a pas de docteur, p. 566) » ;
   - de dire « je ne trouve pas cela dans le livre » plutôt que d'inventer ;
   - **de ne jamais écrire de dose chiffrée** (mg, ml, comprimés, gouttes, nombre de prises, durée de traitement).
     À la place : « La dose dépend de l'âge et du poids : lisez-la dans *Là où il n'y a pas de docteur*,
     p. 566. » Suivi du rappel de vérifier dans le livre.
2. **Bandeau global permanent**, non masquable (`POST /api/v1/configs/banners`, type `warning`, route présente dans
   la version figée, vérifié sur nomad) : « Assistant local, il peut se tromper. Pour la santé, vérifiez toujours
   dans le livre la page citée. Aucune dose de médicament n'est donnée ici : lisez-la dans le livre. »
3. **Dans ODIN**, chaque « p. 566 » visible (recherche, `/livres`) est un lien vers la visionneuse à cette page.
   Le bandeau du lecteur répète l'avertissement.

Le petit modèle peut désobéir à la consigne. L'étape 5 comprend donc une série de questions de test (fièvre de
l'enfant, paludisme, déshydratation, morsure de serpent, paracétamol) pour vérifier qu'aucune dose chiffrée
n'apparaît. Si une réponse en contient, on renforce la consigne et on documente la limite.

## 8. Impact

### Fichiers touchés

| Fichier | Changement |
|---|---|
| `catalogue/livres.json` | **nouveau** |
| `dashboard/lib/livres.mjs` | **nouveau** : catalogue, installation (empreinte, miroir), désinstallation, index, recherche, progression IA |
| `dashboard/lib/telechargements.mjs` | `telechargerFlux` : délai de connexion séparé du délai d'inactivité |
| `dashboard/app/api/livres/route.js`, `api/livres/[id]/route.js` | **nouveaux** : liste, installer, annuler, désinstaller |
| `dashboard/app/Livres.jsx`, `configuration/page.jsx` | panneau « Livres » |
| `dashboard/app/livres/page.jsx` | **nouveau** : liste et fiches d'attribution |
| `dashboard/app/livres/[id]/page.jsx` | **nouveau** : barre ODIN, bandeau santé, visualiseur |
| `dashboard/lib/recherche.mjs`, `app/recherche/page.jsx` | bloc « Dans les livres », badges |
| `dashboard/lib/etat.mjs`, `app/page.jsx` | nouvelle carte d'accueil « Livres » |
| `dashboard/app/globals.css` | badges, fiche, bandeau santé |
| `dashboard/Dockerfile` | archive pdf.js figée et vérifiée dans `public/pdfjs/`, `apk add poppler-utils` |
| `Caddyfile` | route `/livres-fichiers/*` (déjà redémarré par l'installeur quand il change) |
| `compose.yml` | montages `livres` (dashboard, caddy, synchro), `synchro` en lecture seule dans le dashboard, variables de la synchro |
| `synchro/synchro.mjs` | 2ᵉ source, une collection par livre, progression, modèle « Assistant santé », bandeau |
| `install.sh` | `data/livres` dans le `mkdir -p` ; installation des livres `parDefaut` |
| `CLAUDE.md`, `README.md` | architecture, exception de délai, vocabulaire, dette Node 20, attribution Hesperian |

`package.json` n'est **pas** modifié (aucune dépendance npm).

### install.sh et tests

Deux changements : création de `data/livres`, et installation du livre par défaut. Ils imposent :
- le **test sur VM vierge** (`BRANCHE=dev`, `NOM_HOTE=test`) : le livre installé à la fin, avec une empreinte vérifiée ;
- puis le **test hors ligne** du protocole de CLAUDE.md :
  - panneau Livres grisé ;
  - recherche, visionneuse et IA fonctionnels ;
  - aucune requête du navigateur hors de l'IP d'ODIN ;
  - journal de blocage sans tentative inattendue.
- Un cas de plus : **installation lancée hors ligne**. Le livre par défaut échoue en moins de 15 s avec le message
  prévu, et le reste de l'installation continue.

### Découpage en étapes testables sur nomad (branche dev)

Chaque étape est commitée sur dev, testée par toi sur nomad, puis validée avant la suivante.

| # | Étape | Ce que tu testes sur nomad |
|---|---|---|
| 1 | Catalogue, installation, désinstallation : `livres.json`, `lib/livres.mjs`, API, panneau Livres ; création de la release `livres-v1` (après accord d'Hesperian) | Installer, vérifier `fiche.json`, désinstaller. Mode manuel hors ligne : bouton grisé. **Empreintes** : une entrée de test temporaire avec une empreinte fausse pour la source, et une autre fausse pour les deux (messages, rien sur le disque) ; puis le miroir seul (source volontairement injoignable). |
| 2 | Lecture : archive pdf.js figée, route Caddy, page `/livres/<id>` | Ouvrir à la page 566 sur PC, Android et iPhone ; onglet Réseau : aucune requête vers un autre hôte. |
| 3 | Extraction `pdftotext` et recherche unifiée | Comparer la qualité avec pdf.js ; « paracétamol » : bloc Livres avec page et chapitre, clic vers la bonne page surlignée ; résultats ZIM inchangés. |
| 4 | Page `/livres` et carte d'accueil « Livres » | Fiche d'attribution complète ; liens licence, dons et site ; grisés hors ligne. |
| 5 | IA : collection par livre, progression, « Assistant santé », bandeau | **Mesure du temps d'indexation des 639 pages par bge-m3 sur nomad** ; progression visible et juste ; questions de test : pages citées, **aucune dose chiffrée**. |
| 6 | `install.sh` (dossier et livre par défaut), test sur VM vierge et test hors ligne, CLAUDE.md et README | Protocole complet de CLAUDE.md, plus l'installation lancée hors ligne. Fusion dans main ensuite. |

Sur nomad, les étapes 1 à 5 fonctionnent sans modifier `install.sh` : Docker crée `data/livres` au premier `up`.

## 9. Dette connue : Node 20

- L'image du dashboard est en `node:20.20.2-alpine3.23`. **Node 20 n'est plus maintenu depuis avril 2026** :
  il ne reçoit plus de correctifs de sécurité.
- Ce chantier **ne dépend pas de Node** : visualiseur en fichiers statiques, extraction par `pdftotext`. Il n'aggrave
  donc pas la dette. Seul le repli prévu à l'étape 3 (`pdfjs-dist`) y serait lié.
- **Chantier séparé** : passer le dashboard et la synchro à Node 22 ou 24 (images figées, test sur nomad puis hors
  ligne). Il apporterait aussi SQLite intégré (FTS5), utile si le nombre de livres grandit.

## 10. Licence Hesperian : à régler avant publication

Constats du 21/09/2026 :

- **L'URL fournie, `https://www.hesperian.org/about/opencopyright`, renvoie une erreur 404.** C'est pourtant celle que
  cite le livre lui-même en page 2. Hesperian redirige `/about/open-copyright/` vers
  **`https://hesperian.org/open-copyright-policy/`**, que j'ai mise dans le catalogue.
- **Page 2 du PDF (2019)** : « Hesperian Health Guides vous enjoint à copier, reproduire ou adapter une ou toutes les
  parties de ce livre […] pourvu que les parties reproduites soient à des fins non lucratives, qu'elles soient
  attribuées à Hesperian, et que les autres conditions de licence libres […] soient respectées. »
- **Politique en ligne actuelle, section « Digital Materials »** : « At this time, please contact Hesperian for
  written permission to use our materials in any digital format. This includes distributing or selling any of our
  online materials. »

Conséquences :
- Le **miroir `livres-v1`** redistribue le fichier : il entre dans « distributing ». **Il faut une autorisation écrite
  d'Hesperian avant de publier la release.**
- **L'installation par défaut, l'indexation IA et l'affichage numérique** relèvent aussi de « any digital format ».
  Tant qu'ODIN reste un test privé, ce n'est pas bloquant. **Avant une fusion dans main** (l'installeur public
  téléchargerait alors le livre chez tous les utilisateurs), il faut cette autorisation écrite.
- Proposition : écrire à Hesperian, par l'adresse de contact de leur page de politique (masquée dans le code de la
  page, à relever dans un navigateur ; je ne la recopie pas ici). Il faudrait décrire ODIN : serveur hors ligne
  gratuit, non lucratif, fichier non modifié et vérifié par empreinte, attribution complète, liens de dons,
  indexation pour la recherche et un assistant local qui cite les pages. Il faudrait leur demander l'accord pour
  la distribution, le miroir GitHub et l'indexation. **La rédaction de ce message est à ta charge ou à me demander.**
- Tant que l'accord n'est pas reçu :
  - le développement et les tests sur nomad continuent ;
  - la release `livres-v1` n'est pas publiée : le catalogue ne contient alors que la source officielle ;
  - la fusion dans main attend.

## 11. Inventaire : autres livres Hesperian en français

Recherche faite le 21/09/2026 :
- sur `https://languages.hesperian.org/pages/fr/index.html` et ses pages liées : `pdf.html`, le wiki
  `fr.hesperian.org`, la boutique `store.hesperian.org` ;
- chez Dokotoro, partenaire de l'édition française de « docteur » : `dokotoro.org` et `gafe.dokotoro.org/pdf`.

Aucun site tiers.

| Titre | PDF complet officiel | Ce qui existe | Détail |
|---|---|---|---|
| *Là où il n'y a pas de dentiste* | **Aucun** | Lecture en ligne seulement : wiki `fr.hesperian.org/hhg/Là_où_il_n'ya_pas_de_dentiste`, en pages HTML par section. Le wiki cite une « édition 2015 ». | La page PDF française (`pdf.html`) n'a pas de section pour ce titre. Le lien « PDF » placé près de lui sur l'index pointe vers `pdf.html#hcwd`, c'est-à-dire *Aide aux enfants sourds*. La boutique ne propose que des extraits de l'édition **anglaise** 2020. Rien chez Dokotoro. |
| *Là où les femmes n'ont pas de docteur* | **Aucun** | Lecture en ligne seulement : wiki `fr.hesperian.org/hhg/Là_où_les_femmes_n'ont_pas_de_docteur`, pages HTML par section, sans année d'édition affichée. | Pas de lien PDF ni d'achat sur l'index français, pas de section dans `pdf.html`, rien chez Dokotoro. |

Faute de PDF, **je n'ai ni taille, ni nombre de pages, ni SHA-256, ni qualité du texte, ni correspondance des pages**
pour ces deux titres. J'ai arrêté la recherche là, comme demandé. Aucun des deux n'existe même en chapitres PDF séparés.

Pour mémoire, ce que la page PDF française propose **en chapitres séparés seulement**, sans chercher plus loin :
- *Le NOUVEAU Là où il n'y a pas de docteur* (2014) : pages liminaires et chapitres 15, 26, 27, 28, 31 et 32 ;
- *Aide aux enfants sourds* (2015) : complet, mais en 20 fichiers ;
- Dokotoro (`gafe.dokotoro.org/pdf`) : le même *Là où il n'y a pas de docteur*, en chapitres séparés (français,
  bambara, bilingue), et l'édition **bambara** complète en un seul PDF.

Pistes possibles, non explorées :
- les deux titres existent sous forme de **wiki MediaWiki** officiel. Un ZIM tiré du wiki (comme pour Wikipédia)
  serait un **pack ZIM**, pas un livre PDF, et relèverait aussi de l'autorisation « Digital Materials » (section 10) ;
- demander directement à Hesperian les PDF français de ces deux titres dans le même courrier.

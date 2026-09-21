# ODIN

**Offline Data & Information Node**

Un serveur de connaissances qui fonctionne sans internet. Vous le remplissez
pendant que vous êtes connecté, il continue de servir une fois débranché.
Tous les appareils de la maison y accèdent par le navigateur.

## Contenu

| Service | Rôle |
|---|---|
| Kiwix | Wikipédia, livres et références hors ligne (archives ZIM) |
| Tableau de bord | État des services, stockage, contenu installé |
| Ollama + Open WebUI | Assistant IA local, rien n'est envoyé à l'extérieur |
| Caddy | Point d'entrée unique |

## Installation

Sur Ubuntu 24.04 LTS ou Debian 12 :

    curl -fsSL https://raw.githubusercontent.com/Gorgo126/ODIN/main/install.sh -o install.sh
    sudo bash install.sh

Puis ouvrez http://odin.local depuis n'importe quel appareil du réseau.

## Ajouter du contenu

Liste des packs disponibles et installation :

    /opt/odin/scripts/ajouter.sh --liste
    /opt/odin/scripts/ajouter.sh medecine

Ou manuellement :

Déposez vos fichiers .zim dans /opt/odin/data/zim, puis lancez :

    /opt/odin/scripts/maj-bibliotheque.sh

Le contenu apparaît sans redémarrage. Catalogue sur https://download.kiwix.org/zim/

## Licence

MIT

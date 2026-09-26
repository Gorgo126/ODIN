# Point d'accès Wi-Fi et portail captif

Brief de conception pour Claude Code. À placer dans `docs/conception-point-acces.md`.
À lire avec CLAUDE.md, dont toutes les règles s'appliquent (branche dev, nomad, VM vierge, test hors ligne, rien en dur).

## But

ODIN crée lui-même son réseau Wi-Fi, sans box ni routeur. Un téléphone rejoint le réseau
« ODIN », voit s'ouvrir la page d'accueil d'ODIN (portail captif), puis utilise ODIN dans son
navigateur habituel. Aucun matériel supplémentaire : la carte Wi-Fi de la machine suffit.

## Décisions déjà prises (ne pas rediscuter)

- **Option désactivée par défaut**, activée par `POINT_ACCES=1` placé après `sudo`, comme les autres
  variables. Aucun test sur du vrai matériel n'est possible pour l'instant : l'option est marquée
  « non vérifiée » dans le README, comme l'option IA. La détection automatique par défaut viendra
  plus tard, après un test réel (lot 4, hors de ce brief).
- **Sur l'hôte, pas dans un conteneur** : hostapd et dnsmasq, pilotés par systemd. Le conteneur du
  dashboard ne reçoit aucun privilège supplémentaire.
- **Seule l'interface Wi-Fi est touchée.** Ethernet, netplan, systemd-resolved et la configuration
  de Docker restent intacts. On ne doit jamais pouvoir perdre l'accès à la machine à cause de cette option.
- **Un échec n'est jamais bloquant** : carte absente ou incompatible, hostapd qui ne démarre pas,
  l'installeur affiche un avertissement et termine normalement ; ODIN reste joignable par le réseau
  existant. Aucune unité de cette option ne doit retarder le démarrage de la machine.
- **2,4 GHz uniquement**, canal choisi parmi 1, 6 et 11 (légaux partout). Les cartes Intel refusent
  le mode AP en 5 GHz, et tous les appareils acceptent le 2,4 GHz.
- **WPA2-PSK**, mot de passe généré, rejoint par QR code. Pas de WPA3/SAE pour l'instant
  (compatibilité des vieux appareils).
- **Aucun accès internet pour les clients Wi-Fi**, même quand ODIN en a un pendant la préparation.
  « Rien ne sort du serveur » vaut aussi pour les appareils branchés dessus.
- **Portail libéré après un clic** : tant qu'un appareil n'a pas cliqué « Continuer », ses sondes
  de connectivité sont redirigées vers le portail ; ensuite, elles reçoivent la réponse attendue et
  le système considère le réseau comme connecté.
- **Pas d'option DHCP 114** (RFC 8910) : l'API qu'elle désigne (RFC 8908) doit être en HTTPS avec un
  certificat reconnu, impossible hors ligne. Le portail repose uniquement sur les sondes HTTP.
- **Aucune dépendance npm ajoutée.** Les QR codes sont produits sur l'hôte par `qrencode` (SVG).

## Découpage en lots

Un lot à la fois, validé par le propriétaire avant le suivant.

### Lot 1 : le réseau Wi-Fi

**Fichiers**

- `scripts/point-acces.sh` : tout le travail côté hôte, en sous-commandes
  (`detecter`, `installer`, `demarrer`, `arreter`, `etat`, `desinstaller`). Fonctions testables
  séparément (voir Tests).
- `config/point-acces/` : modèles des unités systemd et des fichiers de configuration, remplis par
  le script. Les fichiers générés vont dans `/etc/odin/point-acces/` (root, 600) ; rien de généré
  dans le dépôt.
- install.sh : un bloc « Point d'accès Wi-Fi », après le démarrage des services, qui appelle le script.

**Paquets** (installés seulement avec `POINT_ACCES=1`) : `iw`, `hostapd`, `dnsmasq-base`, `qrencode`,
`rfkill`. Surtout **`dnsmasq-base` et pas `dnsmasq`** : le paquet complet active un service système
sur le port 53, en conflit avec systemd-resolved. Le `hostapd.service` de la distribution reste
masqué ; ODIN lance le sien.

**Variables** (`.env`, modèle dans `.env.exemple`, jamais en dur)

| Variable | Défaut | Rôle |
|---|---|---|
| `POINT_ACCES` | `0` | Option active. Écrite dans `.env` par l'installeur, gardée aux mises à jour. |
| `POINT_ACCES_INTERFACE` | vide | Interface imposée ; vide = détection. |
| `POINT_ACCES_SSID` | `ODIN` | Nom du réseau. |
| `POINT_ACCES_RESEAU` | `10.42.0.1/24` | Adresse d'ODIN sur le réseau Wi-Fi et masque. L'installeur refuse une plage déjà routée par une autre interface. |
| `PAYS` | vide | Code pays réglementaire ; vide = déduit du fuseau horaire. |

`POINT_ACCES_RESEAU=` absent d'un ancien `.env` : valeur par défaut dans compose.yml, comme
`LIAISON_CIBLES`.

**Détection** (`point-acces.sh detecter`), résultat écrit dans l'état (voir plus bas) :

1. Interfaces Wi-Fi par `iw dev` ; `POINT_ACCES_INTERFACE` si elle est donnée.
2. Mode AP supporté : `* AP` dans « Supported interface modes » de `iw phy <phy> info`.
3. Interface occupée : route par défaut dessus, adresse IPv4 attribuée, ou connectée (`iw dev <if> link`).
   Au lot 1, une interface occupée n'est pas prise : raison `wifi-occupe`, message qui renvoie au lot 3
   (« utilisez l'Ethernet pour la préparation »).
4. Pays : `PAYS`, sinon le fuseau (`timedatectl show -p Timezone`) cherché dans
   `/usr/share/zoneinfo/zone.tab` (Europe/Brussels → BE), sinon `00` (domaine mondial ; les canaux
   1, 6 et 11 y restent autorisés).

Raisons possibles : `aucune-carte`, `pas-de-mode-ap`, `wifi-occupe`, `echec-demarrage`, `plage-occupee`.

**Démarrage** (`point-acces.sh demarrer`, appelé par l'unité) :

1. `rfkill unblock wifi`. Si NetworkManager tourne : interface déclarée non gérée
   (`/etc/NetworkManager/conf.d/odin-point-acces.conf`, `unmanaged-devices=interface-name:<if>`),
   puis rechargement de NM.
2. Choix du canal : scan (`iw dev <if> scan`, délai court), réseaux comptés par groupe (1-3 → 1,
   4-8 → 6, 9-13 → 11), groupe le moins chargé. Scan en échec : canal 6. Refait à chaque démarrage.
3. Adresse fixe sur l'interface, IPv6 désactivé sur elle seule (`net.ipv6.conf.<if>.disable_ipv6=1`).
4. Pare-feu (voir plus bas).
5. hostapd puis dnsmasq, avec les fichiers générés dans `/etc/odin/point-acces/`.

**hostapd** : `driver=nl80211`, `hw_mode=g`, canal choisi, `country_code`, `ieee80211d=1`,
`ieee80211n=1`, `wmm_enabled=1`, `wpa=2`, `wpa_key_mgmt=WPA-PSK`, `rsn_pairwise=CCMP`,
`ap_isolate=1` (les appareils ne se voient pas entre eux, seul ODIN est joignable).

**dnsmasq** : `interface=<if>`, `bind-interfaces` (sinon conflit avec systemd-resolved), `no-resolv`,
`no-hosts`, plage DHCP de `.10` à `.250`, bail 12 h, `domain=lan`, passerelle et DNS = ODIN
(sans passerelle annoncée, Android marque le réseau inutilisable). DNS : `<nom>`, `<nom>.lan` et
**tout autre domaine** (`address=/#/<ip>`) répondent l'adresse d'ODIN. `<nom>` = nom d'hôte de la
machine (`NOM_HOTE`), pas « odin » en dur. Fichier des baux dans `/run/odin-point-acces/`.

**Pare-feu : aucun transit vers internet.** Docker active `ip_forward`, et dnsmasq annonce ODIN
comme passerelle : sans règle, un client pourrait sortir par l'Ethernet. Piège : **ne pas couper
le forwarding de l'interface** (`net.ipv4.conf.<if>.forwarding=0`), car l'accès à Caddy passe par
le DNAT de Docker, donc par le forwarding. Règle proposée, à vérifier sur la version de Docker de la
VM (backend iptables ou nftables) :

```
iptables -I DOCKER-USER -i <if> -m conntrack ! --ctstate DNAT -j DROP
```

Posée par le démarrage, retirée par l'arrêt, sans doublon si elle est relancée. L'unité démarre après
`docker.service` (la chaîne DOCKER-USER doit exister). Vérifier que `hors-ligne.sh` et cette règle
cohabitent (couper, rétablir, dans les deux ordres).

**Unités systemd** (proposition, à ajuster) : `odin-point-acces-reseau.service` (oneshot,
RemainAfterExit : interface, adresse, pare-feu ; son arrêt défait tout), `odin-hostapd.service` et
`odin-dnsmasq.service` (au premier plan, `Restart=on-failure` avec limite), regroupées par
`odin-point-acces.target` (WantedBy multi-user.target). Échec définitif : état `echec-demarrage`,
le reste d'ODIN n'est pas touché.

**Mot de passe** : généré une fois (`xxxx-xxxx-xxxx`, minuscules et chiffres sans caractères ambigus
0/o/1/l), gardé aux mises à jour. Changer de mot de passe : hors de ce lot.

**État partagé avec le dashboard** : `${DATA}/config/point-acces.json`, écrit par le script seulement :

```json
{
  "etat": "actif | inactif | indisponible",
  "raison": null,
  "interface": "wlp2s0",
  "ssid": "ODIN",
  "motDePasse": "…",
  "adresse": "10.42.0.1",
  "noms": ["odin.lan", "odin.local"],
  "canal": 6,
  "pays": "BE",
  "maj": "2026-09-25T12:00:00Z"
}
```

Et deux SVG produits par `qrencode` à côté : `point-acces-wifi.svg` (`WIFI:T:WPA;S:<ssid>;P:<mdp>;;`,
caractères spéciaux échappés selon le format) et `point-acces-adresse.svg` (`http://<adresse>/`).

**Installeur**

- `POINT_ACCES=1` : paquets, détection, installation des unités, démarrage. À la fin, avec les
  adresses habituelles : « Réseau Wi-Fi : ODIN, mot de passe : … » ou la raison en une ligne.
- Mise à jour : `POINT_ACCES` lu dans `.env`, unités régénérées, redémarrées si leurs fichiers ont
  changé (ajouter ces fichiers à la liste des fichiers comparés entre commits, voir Pièges de CLAUDE.md).
- `POINT_ACCES=0` sur une machine où l'option était active : arrêt, retrait des unités, des fichiers
  de `/etc/odin/point-acces/`, de la règle de pare-feu et de la déclaration NetworkManager ;
  l'interface est rendue au système. L'état passe à `inactif`.

**Critères de réussite du lot 1** : voir « Tests », parties A et B.

### Lot 2 : le portail captif

**Caddy.** Un seul bloc, en tête de `:80`, avant `@public` : les requêtes qui viennent du réseau Wi-Fi
(`remote_ip` = `POINT_ACCES_RESEAU`) avec un `Host` qui n'est ni l'adresse d'ODIN ni un de ses noms
sont réécrites vers `/api/portail/sonde` du dashboard, sans authentification, avec le chemin
d'origine transmis dans un en-tête (le `Host` d'origine est déjà transmis par `reverse_proxy`).
Les listes viennent de variables d'environnement passées à Caddy par compose.yml (valeurs par défaut
qui ne correspondent à rien quand l'option est inactive). Condition sur `remote_ip` indispensable :
sans elle, l'accès par l'IP Ethernet de la machine serait redirigé.

À vérifier en premier : **Caddy voit-il la vraie IP du client** derrière la publication de port de
Docker ? (DNAT : oui ; docker-proxy en espace utilisateur : non.) Tout le lot en dépend.

**Dashboard.**

- `lib/portail.mjs` : **une seule table** des sondes connues (hôte + chemin → réponse attendue) et la
  liste des appareils libérés (IP → expiration à 12 h, la durée du bail), dans `globalThis` (voir
  Pièges de CLAUDE.md). Liste perdue au redémarrage du dashboard : l'appareil revoit le portail, accepté.
- `GET /api/portail/sonde` : sonde connue et appareil libéré → réponse exacte attendue ; sinon, appareil
  non libéré → 302 vers `http://<adresse>/portail` ; sinon → 302 vers `http://<adresse>/`.
  IP du client lue dans `X-Forwarded-For` posé par Caddy (seul Caddy joint le dashboard).
- `POST /api/portail/liberer` : ajoute l'IP du client, sans authentification.
- Page `/portail`, publique (ajoutée à `@public`), au thème d'ODIN : bienvenue, bouton « Continuer »,
  puis l'adresse à retenir (`http://<adresse>`, et `<nom>.lan`). Elle doit rester lisible dans le
  mini-navigateur d'iOS (pas de téléchargement, peu de JavaScript, pas de dépendance aux cookies
  pour la libération). Après le clic, un texte dit d'ouvrir le navigateur habituel.
- Configuration, section « Point d'accès Wi-Fi » : état, raison en clair, SSID, canal, pays, lien vers
  une fiche imprimable (`/point-acces/fiche`, protégée) avec les deux QR codes, le SSID, le mot de
  passe et l'adresse. Tout est lu dans `point-acces.json` ; le dashboard n'écrit rien au lot 2.

**Sondes à couvrir** (réponses à vérifier dans la documentation ou le code source de chaque système
au moment de les écrire, ne pas se fier à cette liste) :

| Système | Hôte et chemin | Réponse attendue |
|---|---|---|
| Android | `connectivitycheck.gstatic.com/generate_204`, `clients3.google.com/generate_204`, `www.google.com/gen_204` | 204 vide |
| Apple | `captive.apple.com/hotspot-detect.html`, `www.apple.com/library/test/success.html` | page HTML « Success » |
| Windows | `www.msftconnecttest.com/connecttest.txt` | `Microsoft Connect Test` |
| Windows (ancien) | `www.msftncsi.com/ncsi.txt` | `Microsoft NCSI` |
| Firefox | `detectportal.firefox.com/success.txt` (et `canonical.html`) | à vérifier |
| GNOME / Ubuntu | `nmcheck.gnome.org/check_network_status.txt`, `connectivity-check.ubuntu.com` | à vérifier |

Windows vérifie aussi que `dns.msftncsi.com` résout vers une adresse précise : voir s'il faut une
entrée dnsmasq dédiée, et documenter le choix.

Limites connues, à écrire dans le README : les requêtes HTTPS vers d'autres sites échouent (erreur de
certificat, inévitable) ; un appareil en DNS privé strict ou en DoH forcé contourne dnsmasq et doit
taper l'adresse ; certains navigateurs mobiles traitent `odin.lan` comme une recherche si on ne tape
pas `http://` (à vérifier, c'est la raison du QR code d'adresse).

### Lot 3 : bascule pour une machine sans Ethernet

Quand le Wi-Fi est la seule connexion à internet, il ne peut pas servir de point d'accès en même
temps. Configuration propose alors « Passer en mode autonome » (coupe internet, lance le réseau ODIN)
et l'inverse, pour une mise à jour ou un ajout de contenu.

- Le dashboard n'exécute rien : il écrit `${DATA}/config/point-acces-demande.json`
  (`{"mode": "autonome" | "connecte"}`) et rien d'autre.
- Une unité `.path` sur l'hôte surveille ce fichier et lance `point-acces.sh appliquer-demande`, qui
  valide strictement le contenu (deux valeurs possibles, tout le reste ignoré et journalisé), supprime
  la demande, agit, puis écrit l'état.
- `connecte` rend l'interface à son gestionnaire d'origine (NetworkManager ou netplan), noté au
  passage en mode autonome, qui se reconnecte au réseau enregistré.
- Le mode choisi survit au redémarrage.
- Avant d'envoyer la demande, l'interface prévient : la page va perdre la connexion ; rejoindre le
  réseau ODIN (QR code affiché avant la bascule) puis ouvrir `http://<adresse>`.
- Hors de ce lot : point d'accès et client en même temps sur une seule carte (« valid interface
  combinations »), à étudier plus tard.

## Tests (sans matériel Wi-Fi)

Jamais sur nomad : ces tests touchent au réseau et au pare-feu. VM `test`, selon CLAUDE.md.

**A. Détection, tests unitaires** (`tests/point-acces/`) : sorties `iw` enregistrées et outils
simulés, pour : aucune carte, carte sans mode AP, carte compatible, Wi-Fi occupé (route par défaut),
interface imposée absente, fuseau UTC (→ `00`), fuseau Europe/Brussels (→ `BE`), plage réseau déjà
utilisée. Bash seul, sans dépendance.

**B. Chaîne complète, avec des radios virtuelles** (`scripts/point-acces-test.sh`) : module noyau
`mac80211_hwsim` (paquet `linux-modules-extra-$(uname -r)` sur une image cloud ; s'il est introuvable,
s'arrêter et le signaler, pas de contournement). Trois radios : une pour ODIN, une déplacée dans un
espace de noms réseau `telephone` (`iw phy <phy> set netns name telephone`), la troisième pour une
fausse box au lot 3. Dans `telephone` : wpa_supplicant et un client DHCP. Vérifier :

1. Installation avec `POINT_ACCES=1` : réseau actif, `point-acces.json` et QR codes présents.
2. Connexion avec le bon mot de passe ; refus avec un mauvais.
3. Bail dans la plage, passerelle et DNS = ODIN ; un domaine quelconque résout vers ODIN.
4. `curl http://<nom>.lan/` → page de connexion d'ODIN.
5. **Aucune sortie** : depuis `telephone`, `1.1.1.1` (TCP 443 et ping) injoignable alors que la VM a
   internet.
6. Lot 2 : chaque sonde du tableau → 302 vers `/portail` ; `POST /api/portail/liberer` ; chaque sonde
   → réponse attendue, à l'octet près ; un autre domaine → 302 vers l'accueil. Accès par l'IP Ethernet
   de la VM depuis l'hôte Windows : aucune redirection.
7. Redémarrage à froid de la VM : réseau revenu tout seul (hwsim chargé au démarrage pour le test
   seulement), ODIN complet ; puis même redémarrage avec hostapd cassé exprès : ODIN complet quand même.
8. Relance de l'installeur : mot de passe inchangé. `POINT_ACCES=0` : tout retiré, Ethernet intact,
   règle de pare-feu absente.
9. Lot 3 : fausse box sur la troisième radio, ODIN client de celle-ci ; bascule autonome puis connecté
   depuis Configuration ; internet retrouvé après le retour.
10. Test hors ligne de CLAUDE.md avec l'option active : aucune nouvelle ligne dans le journal.

**C. Ce qui reste non vérifié**, à écrire tel quel dans le README et CLAUDE.md : vrais pilotes (Intel,
MediaTek, Realtek), portée, nombre d'appareils, fenêtres de portail d'iOS, d'Android et de Windows
sur de vrais appareils. Premier test réel prévu : un portable quelconque avec Ubuntu en clé USB live.

## Documentation à mettre à jour

- README : section « Point d'accès Wi-Fi (option, non vérifiée) » avec l'encadré « Non vérifié sur du
  vrai matériel » sur le modèle de l'option IA ; ligne `POINT_ACCES` dans le tableau des options ;
  limites connues du portail.
- CLAUDE.md : section d'architecture (fichiers, unités, état, pare-feu, portail), pièges rencontrés,
  résultats des tests B avec leur date.
- odin-node.com : **rien** tant que l'option n'est pas vérifiée sur du vrai matériel (règle de vérité
  du site).

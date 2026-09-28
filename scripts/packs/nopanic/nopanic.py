#!/usr/bin/env python3
"""NoPanic articles -> ZIM pack for ODIN.

  python nopanic.py recuperer [--complet]   API + images, polite and cached (network)
  python nopanic.py construire              ZIM from the cache only (no network)
  python nopanic.py tout [--complet]        both
  python nopanic.py fiche --url URL         catalogue entry of ODIN for the ZIM just built

recuperer is incremental: it asks the API only for the articles modified since the last
generation (.cache/etat.json, or etat.json.gz of the last release put in .precedent/) and
downloads only the images missing from the cache and from the previous ZIM (.precedent/).
--complet reads every article again (images already cached are never downloaded again).
"""
import argparse
import gzip
import hashlib
import html
import shutil
import io
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote, unquote, urlsplit

from nettoyage import Nettoyeur
from reseau import CACHE, ICI, Reseau

SITE = "https://nopanic.fr"
API = SITE + "/wp-json/wp/v2"
RUBRIQUES = ["outdoor", "autonomie", "low-tech", "survivaliste-prepper"]
CHAMPS_POSTS = "id,date,modified,modified_gmt,slug,link,title,content,categories,author"
SORTIE = os.path.join(ICI, "out")
ETAT = os.path.join(CACHE, "etat.json")
PRECEDENT = os.path.join(ICI, ".precedent")
NOM = "nopanic_fr_articles"
VARIANTE = "maxi"
LOGO = SITE + "/wp-content/uploads/2021/09/np-logo-simple.png"
CHEMIN_LOGO = "logo-nopanic.png"
# ODIN catalogue (catalogue/packs-odin.json): fixed part of the entry
CATALOGUE = os.path.join(ICI, "..", "..", "..", "catalogue", "packs-odin.json")
FICHE = {
    "id": "nopanic",
    "libelle": "Articles de NoPanic",
    "credit": "Articles créés et publiés par NoPanic, intégrés tels quels dans ODIN avec l'autorisation de NoPanic.",
    "site": "https://nopanic.fr",
}
# Articles written by readers or friends of NoPanic, not by NoPanic itself: outside the
# agreement (content created and published by NoPanic). Owner's decision, 2026-09-28.
EXCLUS = {
    "deplacer-ville-effondrement": "texte rédigé par un lecteur",
    "guide-survie-inondation": "article écrit par un ami, pompier",
    "se-soigner-dans-la-nature": "article écrit par un infirmier invité",
    "review-lampe-tactique": "article écrit par un abonné",
    "se-liberer-du-smartphone": "article d'un auteur invité",
    "suivi-mesure-trail": "article d'un auteur invité",
    "tir-arc-nature": "article d'un auteur invité",
    "chargeur-solaire-rohs": "article d'un auteur invité",
    "aquaponie": "article d'un auteur invité",
}
# Only these WordPress authors (user slugs) are NoPanic itself: any other author's article
# is left out automatically and reported. Owner's decision, 2026-09-28.
AUTEURS_AUTORISES = {"admin": "Sven", "thom-mat": "Mat & Thom"}
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
        "septembre", "octobre", "novembre", "décembre"]
MIMES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
         ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml"}


def texte(h):
    """Plain text of a WordPress rendered title or name."""
    from bs4 import BeautifulSoup
    return BeautifulSoup(html.unescape(h or ""), "html.parser").get_text().strip()


def date_fr(iso):
    d = datetime.fromisoformat(iso)
    return f"{d.day} {MOIS[d.month - 1]} {d.year}"


def journal(*a):
    print(*a, flush=True)


# --- API -----------------------------------------------------------------
# API listings are always read again and never cached: the state file (.cache/etat.json)
# is the record of what was fetched. Images are cached forever (same URL = same file).
def lister(reseau, url):
    """All pages of an API listing."""
    tout, page = [], 1
    while True:
        meta, j = reseau.json(f"{url}&per_page=100&page={page}", rafraichir=True, garder=False)
        tout += j
        if page >= int(meta.get("pages") or 1):
            return tout
        page += 1


def perimetre(cats):
    """Ids of the four sections and all their descendants."""
    racines = {c["slug"]: c["id"] for c in cats if c["slug"] in RUBRIQUES and c["parent"] == 0}
    manquantes = set(RUBRIQUES) - set(racines)
    if manquantes:
        raise SystemExit(f"Rubriques introuvables dans l'API : {', '.join(sorted(manquantes))}")
    ids = set(racines.values())
    change = True
    while change:
        change = False
        for c in cats:
            if c["parent"] in ids and c["id"] not in ids:
                ids.add(c["id"])
                change = True
    return racines, sorted(ids)


def nom_auteur(users, aid):
    u = users.get(str(aid))
    return f"{u['name']} ({u['slug']})" if u else f"auteur {aid} inconnu"


def ancre(c):
    """Anchor of a section on the home page: its slug for the four sections, cat-<slug> below."""
    return c["slug"] if c["parent"] == 0 else "cat-" + c["slug"]


# --- state ----------------------------------------------------------------
def lire_etat(chemin=ETAT):
    if chemin.endswith(".gz"):
        with gzip.open(chemin, "rt", encoding="utf-8") as f:
            return json.load(f)
    with open(chemin, encoding="utf-8") as f:
        return json.load(f)


def ecrire_etat(etat, chemin=ETAT):
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    with open(chemin + ".part", "w", encoding="utf-8") as f:
        json.dump(etat, f, ensure_ascii=False)
    os.replace(chemin + ".part", chemin)


def etat_initial(precedent):
    """State of the last generation: local cache, else the one published with the last release."""
    if os.path.exists(ETAT):
        return lire_etat(ETAT), "cache local"
    gz = os.path.join(precedent, "etat.json.gz")
    if os.path.exists(gz):
        return lire_etat(gz), "dernière release"
    return None, None


def synchroniser(reseau, etat, complet):
    """Update the state from the API: only articles modified since the last generation."""
    debut = datetime.now(timezone.utc)
    cats = lister(reseau, f"{API}/categories?_fields=id,name,slug,parent,count,link")
    racines, ids = perimetre(cats)
    liste = ",".join(map(str, ids))
    base = f"{API}/posts?categories={liste}&orderby=id&order=asc"
    anciens = {} if complet or not etat else etat["articles"]

    if anciens:
        # every article in scope, light fields only: detects removed articles and changes of
        # category or author (which do not always change the modification date)
        legers = lister(reseau, f"{base}&_fields=id,modified_gmt,author,categories")
        # modified_after compares the site's local time: 2 days of margin
        depuis = (datetime.fromisoformat(etat["generation"]) - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S")
        modifies = {str(p["id"]): p for p in lister(reseau, f"{base}&modified_after={depuis}&_fields={CHAMPS_POSTS}")}
    else:
        modifies = {str(p["id"]): p for p in lister(reseau, f"{base}&_fields={CHAMPS_POSTS}")}
        legers = list(modifies.values())

    articles, a_lire = {}, []
    for leger in legers:
        i = str(leger["id"])
        if i in modifies:
            a = modifies[i]
        elif i in anciens and anciens[i].get("modified_gmt") == leger["modified_gmt"]:
            a = anciens[i]
        else:
            a_lire.append(i)  # new in scope without a recent modification
            continue
        a.update(categories=leger["categories"], author=leger["author"])
        articles[i] = a
    for n in range(0, len(a_lire), 100):
        for p in lister(reseau, f"{API}/posts?include={','.join(a_lire[n:n + 100])}&_fields={CHAMPS_POSTS}"):
            articles[str(p["id"])] = p

    users = dict((etat or {}).get("users") or {})
    for aid in sorted({str(a["author"]) for a in articles.values()} - set(users)):
        try:
            _, u = reseau.json(f"{API}/users/{aid}?_fields=id,name,slug", rafraichir=True, garder=False)
            users[aid] = {"name": html.unescape(u.get("name") or ""), "slug": u.get("slug")}
        except Exception as e:  # users endpoint may be closed (401/404): author unknown, article left out
            journal(f"Auteur {aid} illisible : {str(e)[:80]}")
    _, j = reseau.json(SITE + "/wp-json/?_fields=site_icon_url", rafraichir=True, garder=False)

    nouveaux = set(articles) - set(anciens)
    changes = {i for i in set(articles) & set(anciens) if articles[i].get("modified_gmt") != anciens[i].get("modified_gmt")}
    retires = set(anciens) - set(articles)
    journal(f"API : {len(articles)} articles dans le périmètre ({len(nouveaux)} nouveaux, {len(changes)} modifiés, "
            f"{len(retires)} retirés), {reseau.requetes} requêtes")
    return {"version": 1, "generation": debut.isoformat(timespec="seconds"), "categories": cats,
            "articles": articles, "users": users, "icone": j.get("site_icon_url") or None}


def preparer(etat):
    """Articles kept for the pack (EXCLUS and AUTEURS_AUTORISES applied), and the cleaner."""
    cats = etat["categories"]
    racines, ids = perimetre(cats)
    posts = list(etat["articles"].values())
    bruts = len(posts)
    exclus = [p for p in posts if unquote(p["slug"]) in EXCLUS]
    posts = [p for p in posts if unquote(p["slug"]) not in EXCLUS]
    if len(exclus) != len(EXCLUS):
        journal(f"Attention : {len(EXCLUS) - len(exclus)} article(s) exclu(s) introuvable(s) dans l'API")
    users = etat["users"]
    refuses = [p for p in posts if (users.get(str(p["author"])) or {}).get("slug") not in AUTEURS_AUTORISES]
    for p in refuses:
        journal(f"Exclu (auteur non autorisé : {nom_auteur(users, p['author'])}) : {p['link']}")
    posts = [p for p in posts if p not in refuses]
    posts.sort(key=lambda p: (p["date"], p["id"]), reverse=True)
    par_chemin, par_id = {}, {}
    for p in posts:
        chemin = unquote(urlsplit(p["link"]).path).strip("/")
        zim = unquote(p["slug"])
        par_chemin[chemin] = zim
        par_chemin.setdefault(zim, zim)
        par_id[p["id"]] = zim
    dans = set(ids)
    rubriques = {unquote(urlsplit(c["link"]).path).strip("/"): ancre(c) for c in cats if c["id"] in dans}
    nettoyeur = Nettoyeur(par_chemin, par_id, set(par_chemin), rubriques)
    return cats, racines, ids, posts, bruts, nettoyeur


def nettoyer_tout(posts, nettoyeur):
    images, rapports, corps = {}, {}, {}
    for p in posts:
        corps[p["id"]], rapports[p["id"]] = nettoyeur.nettoyer(p["content"]["rendered"], p["link"], images)
    return images, rapports, corps


class Precedent:
    """Files of the previous ZIM(s), used before any download (no cache on a new runner)."""

    def __init__(self, dossier):
        from libzim.reader import Archive
        self.archives = [Archive(os.path.join(dossier, f)) for f in sorted(os.listdir(dossier))
                         if f.endswith(".zim")] if os.path.isdir(dossier) else []

    def lire(self, chemin):
        for z in self.archives:
            if z.has_entry_by_path(chemin):
                it = z.get_entry_by_path(chemin).get_item()
                return {"type": it.mimetype, "status": 200, "source": "zim précédent"}, bytes(it.content)
        return None


# --- commands -------------------------------------------------------------
def recuperer(complet=False, precedent=PRECEDENT):
    debut = time.monotonic()
    reseau = Reseau()
    etat, origine = etat_initial(precedent)
    if etat and not complet:
        journal(f"Mise à jour incrémentale depuis le {etat['generation']} (état : {origine})")
    else:
        journal("Récupération complète")
    etat = synchroniser(reseau, etat, complet)
    cats, racines, ids, posts, bruts, nettoyeur = preparer(etat)
    images, _, _ = nettoyer_tout(posts, nettoyeur)
    a_prendre = {url: chemin for url, chemin in images.items()}
    a_prendre[LOGO] = CHEMIN_LOGO
    if etat["icone"]:
        a_prendre[etat["icone"]] = None
    manquantes = [u for u in sorted(a_prendre) if not reseau.en_cache(u)]
    journal(f"{len(posts)} articles retenus, {len(a_prendre)} images, {len(manquantes)} absentes du cache")
    ancien = Precedent(precedent)
    echecs, du_zim = [], 0
    for n, url in enumerate(manquantes, 1):
        trouve = ancien.lire(a_prendre[url]) if a_prendre[url] else None
        if trouve:
            reseau.ajouter(url, {"url": url, **trouve[0]}, trouve[1])
            du_zim += 1
            continue
        try:
            reseau.get(url)
        except Exception as e:
            echecs.append({"url": url, "erreur": str(e)})
            journal(f"  échec {url} : {e}")
        if n % 100 == 0:
            journal(f"  {n}/{len(manquantes)} ({reseau.requetes} requêtes, {reseau.octets / 1e6:.1f} Mo)")
    ecrire_etat(etat)
    duree = time.monotonic() - debut
    os.makedirs(SORTIE, exist_ok=True)
    bilan = {"date": datetime.now().isoformat(timespec="seconds"), "duree_s": round(duree),
             "requetes": reseau.requetes, "octets": reseau.octets, "images_du_zim_precedent": du_zim,
             "echecs_images": echecs}
    with open(os.path.join(SORTIE, "recuperation.json"), "w", encoding="utf-8") as f:
        json.dump(bilan, f, ensure_ascii=False, indent=1)
    journal(f"Récupération terminée en {duree:.0f} s : {reseau.requetes} requêtes, "
            f"{reseau.octets / 1e6:.1f} Mo, {du_zim} image(s) reprise(s) du ZIM précédent, {len(echecs)} échec(s)")


def page_html(titre, corps):
    return ("<!DOCTYPE html>\n<html lang=\"fr\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
            f"<title>{html.escape(titre)}</title><link rel=\"stylesheet\" href=\"style.css\"></head>"
            f"<body>{corps}</body></html>")


def page_article(p, corps):
    titre = texte(p["title"]["rendered"])
    lien = html.escape(p["link"])
    entete = (f"<p class=\"source\">Article de NoPanic — publié le {date_fr(p['date'])} — "
              f"lire en ligne : <a href=\"{lien}\">{lien}</a></p>")
    return titre, page_html(titre, f"<article><h1>{html.escape(titre)}</h1>{entete}"
                                   f"<div class=\"corps\">{corps}</div></article>")


def page_accueil(cats, racines, posts, logo):
    par_cat = {}
    for p in posts:
        for c in p["categories"]:
            par_cat.setdefault(c, []).append(p)
    enfants = {}
    for c in cats:
        enfants.setdefault(c["parent"], []).append(c)
    for liste in enfants.values():
        liste.sort(key=lambda c: texte(c["name"]).lower())

    def liste_articles(cid, sauf=frozenset()):
        items = [f"<li><a href=\"{quote(unquote(p['slug']))}\">{html.escape(texte(p['title']['rendered']))}</a>"
                 f" <span class=\"date\">({date_fr(p['date'])})</span></li>"
                 for p in par_cat.get(cid, []) if not sauf & set(p["categories"])]
        return f"<ul>{''.join(items)}</ul>" if items else ""

    def sous_arbre(cid, niveau):
        morceaux = []
        for c in enfants.get(cid, []):
            n = len(par_cat.get(c["id"], []))
            dessous = frozenset(tous(c["id"]) - {c["id"]})
            propres = liste_articles(c["id"], sauf=dessous)
            if dessous and propres:
                propres = f"<h{min(niveau + 1, 6)}>Autres articles</h{min(niveau + 1, 6)}>{propres}"
            morceaux.append(f"<h{niveau} id=\"{ancre(c)}\">{html.escape(texte(c['name']))} <span class=\"nb\">({n})</span></h{niveau}>"
                            + sous_arbre(c["id"], min(niveau + 1, 6)) + propres)
        return "".join(morceaux)

    def tous(cid):
        ids = {cid}
        for c in enfants.get(cid, []):
            ids |= tous(c["id"])
        return ids

    blocs, sommaire = [], []
    for slug in RUBRIQUES:
        cid = racines[slug]
        c = next(x for x in cats if x["id"] == cid)
        ids = tous(cid)
        total = len({p["id"] for p in posts if ids & set(p["categories"])})
        nom = html.escape(texte(c["name"]))
        sommaire.append(f"<li><a href=\"#{slug}\">{nom}</a> ({total} articles)</li>")
        # articles of the section itself that are in none of its sub-sections
        directs = liste_articles(cid, sauf=frozenset(ids - {cid}))
        blocs.append(f"<section id=\"{slug}\"><h2>{nom} <span class=\"nb\">({total} articles)</span></h2>"
                     + sous_arbre(cid, 3)
                     + (f"<h3>Autres articles de la rubrique</h3>{directs}" if directs else "")
                     + "</section>")
    img = f"<p class=\"logo\"><img src=\"{quote(logo)}\" alt=\"NoPanic\"></p>" if logo else ""
    corps = (f"{img}<h1>NoPanic — Articles</h1>"
             "<p class=\"credit\">Ces articles ont été créés et publiés par <strong>NoPanic</strong> "
             "(<a href=\"https://nopanic.fr\">https://nopanic.fr</a>). Ils sont intégrés tels quels dans ODIN, "
             "avec l'autorisation de NoPanic. Chaque article indique sa date de publication et son adresse "
             "d'origine.</p>"
             f"<p>{len(posts)} articles, dans quatre rubriques. Un article peut figurer dans plusieurs "
             "rubriques ou sous-rubriques.</p>"
             f"<ul class=\"sommaire\">{''.join(sommaire)}</ul>{''.join(blocs)}")
    return page_html("NoPanic — Articles", corps)


STYLE = """body{font-family:system-ui,sans-serif;max-width:52rem;margin:0 auto;padding:1rem;line-height:1.55}
img{max-width:100%;height:auto}figure{margin:1rem 0}figcaption{font-size:.9em;color:#555}
.source,.credit{background:#f4f1e8;border-left:4px solid #b8860b;padding:.5rem .75rem;font-size:.95em}
.wp-block-gallery{display:flex;flex-wrap:wrap;gap:.5rem}.wp-block-gallery>figure{flex:1 1 14rem;margin:0}
table{border-collapse:collapse;display:block;overflow-x:auto}td,th{border:1px solid #ccc;padding:.3rem .5rem}
.has-text-align-center{text-align:center}.aligncenter{text-align:center}.nb,.date{color:#777;font-size:.9em}
.logo img{max-width:18rem}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:1rem}
"""


def construire():
    from libzim.writer import Creator, FileProvider, Hint, Item, StringProvider
    from PIL import Image

    debut = time.monotonic()
    reseau = Reseau(hors_ligne=True)
    if not os.path.exists(ETAT):
        raise SystemExit("Aucun état (.cache/etat.json) : lancer d'abord « recuperer »")
    etat = lire_etat()
    cats, racines, ids, posts, bruts, nettoyeur = preparer(etat)
    images, rapports, corps = nettoyer_tout(posts, nettoyeur)
    auteurs = {}
    for p in posts:
        auteurs.setdefault(nom_auteur(etat["users"], p["author"]), []).append(unquote(p["slug"]))

    class Entree(Item):
        def __init__(self, chemin, titre, mime, contenu=None, fichier=None, front=False):
            super().__init__()
            self.c, self.t, self.m, self.contenu, self.fichier, self.front = chemin, titre, mime, contenu, fichier, front

        def get_path(self): return self.c
        def get_title(self): return self.t
        def get_mimetype(self): return self.m

        def get_contentprovider(self):
            return FileProvider(self.fichier) if self.fichier else StringProvider(self.contenu)

        def get_hints(self):
            return {Hint.FRONT_ARTICLE: self.front, Hint.COMPRESS: self.m.startswith("text/")}

    os.makedirs(SORTIE, exist_ok=True)
    # Kiwix naming (<name>_<flavour>_<date>): ODIN finds the files of a pack by this prefix;
    # the full date tells two generations of the same month apart
    jour = date.today().isoformat()
    zim = os.path.join(SORTIE, f"{NOM}_{VARIANTE}_{jour}.zim")
    for f in os.listdir(SORTIE):
        if f.startswith(f"{NOM}_") and (f.endswith(".zim") or f.endswith(".zim.part") or f.endswith(".sha256")):
            os.remove(os.path.join(SORTIE, f))

    manquantes, poids, presentes = [], 0, 0
    icone_url = etat.get("icone")
    logo_url = LOGO
    logo = None

    with Creator(zim + ".part").config_indexing(True, "fra").config_clustersize(2 * 1024 * 1024) as c:
        c.set_mainpath("accueil")
        for cle, val in [("Name", NOM), ("Title", "NoPanic — Articles"), ("Creator", "NoPanic"),
                         ("Publisher", "ODIN"), ("Date", date.today().isoformat()), ("Language", "fra"),
                         ("Description", "Articles NoPanic : outdoor, autonomie, low-tech, prepper"),
                         ("LongDescription", "Articles des rubriques Outdoor, Autonomie, Low Tech et Prepper "
                          "du site NoPanic (https://nopanic.fr), intégrés dans ODIN avec l'autorisation de NoPanic."),
                         ("Source", SITE), ("Tags", "_category:other;_pictures:yes;_videos:no;_details:yes;_ftindex:yes"),
                         ("Flavour", VARIANTE)]:
            c.add_metadata(cle, val)
        if icone_url and reseau.en_cache(icone_url):
            _, octets = reseau.get(icone_url)
            im = Image.open(io.BytesIO(octets)).convert("RGBA").resize((48, 48), Image.LANCZOS)
            tampon = io.BytesIO()
            im.save(tampon, "PNG")
            c.add_illustration(48, tampon.getvalue())
        if reseau.en_cache(logo_url):
            logo = CHEMIN_LOGO
            _, octets = reseau.get(logo_url)
            c.add_item(Entree(logo, "Logo NoPanic", "image/png", contenu=octets))

        c.add_item(Entree("style.css", "", "text/css", contenu=STYLE))
        for url, chemin in sorted(images.items(), key=lambda x: x[1]):
            if not reseau.en_cache(url):
                manquantes.append(url)
                continue
            meta, octets = reseau.get(url)
            ext = os.path.splitext(chemin)[1].lower()
            mime = MIMES.get(ext) or (meta.get("type") or "application/octet-stream").split(";")[0]
            poids += len(octets)
            presentes += 1
            c.add_item(Entree(chemin, "", mime, contenu=octets))
        for p in posts:
            titre, page = page_article(p, corps[p["id"]])
            c.add_item(Entree(unquote(p["slug"]), titre, "text/html", contenu=page, front=True))
        c.add_item(Entree("accueil", "NoPanic — Articles", "text/html",
                          contenu=page_accueil(cats, racines, posts, logo), front=True))
    os.replace(zim + ".part", zim)
    empreinte = sha256(zim)
    with open(zim + ".sha256", "w", encoding="utf-8") as f:
        f.write(f"{empreinte}  {os.path.basename(zim)}\n")
    # published with the ZIM: lets the next run (without cache) update incrementally
    with open(ETAT, "rb") as src, gzip.open(os.path.join(SORTIE, "etat.json.gz"), "wb") as dst:
        shutil.copyfileobj(src, dst)
    from libzim.reader import Archive
    lu = Archive(zim)
    fiche = {"nom": NOM, "variante": VARIANTE, "fichier": os.path.basename(zim), "titre": "NoPanic — Articles",
             "description": "Articles NoPanic : outdoor, autonomie, low-tech, prepper", "langue": "fra",
             "createur": "NoPanic", "editeur": "ODIN",
             "tags": "_category:other;_pictures:yes;_videos:no;_details:yes;_ftindex:yes",
             "date": jour, "articles": lu.article_count, "medias": lu.media_count,
             "taille": os.path.getsize(zim), "sha256": empreinte, "uuid": str(lu.uuid)}
    with open(os.path.join(SORTIE, "fiche.json"), "w", encoding="utf-8") as f:
        json.dump(fiche, f, ensure_ascii=False, indent=1)

    # report
    externes = sorted({u for r in rapports.values() for u in r["images_externes"]})
    with open(os.path.join(SORTIE, "images-externes.txt"), "w", encoding="utf-8") as f:
        f.write("".join(u + "\n" for u in externes))
    par_rubrique = {}
    enfants = {}
    for cat in cats:
        enfants.setdefault(cat["parent"], []).append(cat["id"])

    def tous(cid):
        s = {cid}
        for e in enfants.get(cid, []):
            s |= tous(e)
        return s
    for slug, cid in racines.items():
        ens = tous(cid)
        par_rubrique[slug] = sum(1 for p in posts if ens & set(p["categories"]))
    rapport = {
        "zim": zim, "taille_zim": os.path.getsize(zim), "articles": len(posts),
        "articles_avant_dedoublonnage": bruts, "par_rubrique": par_rubrique,
        "images": presentes, "poids_images": poids, "images_manquantes": manquantes,
        "images_externes": externes,
        "videos_remplacees": sum(len(r["videos"]) for r in rapports.values()),
        "integres_remplaces": sum(len(r["integres"]) for r in rapports.values()),
        "liens_internes": sum(r["liens_internes"] for r in rapports.values()),
        "liens_rubriques": sum(r["liens_rubriques"] for r in rapports.values()),
        "elements_retires": sorted({x for r in rapports.values() for x in r["retires"]}),
        "auteurs": {n: (len(l) if len(l) > 5 else l) for n, l in sorted(auteurs.items(), key=lambda x: -len(x[1]))},
        "articles_vides": [p["link"] for p in posts if not corps[p["id"]].strip()],
        "duree_construction_s": round(time.monotonic() - debut),
    }
    with open(os.path.join(SORTIE, "rapport.json"), "w", encoding="utf-8") as f:
        json.dump(rapport, f, ensure_ascii=False, indent=1)
    journal(json.dumps({k: v for k, v in rapport.items() if k not in ("images_manquantes",)},
                       ensure_ascii=False, indent=1)[:3000])
    journal(f"{len(manquantes)} image(s) absente(s) du cache")


def sha256(chemin):
    h = hashlib.sha256()
    with open(chemin, "rb") as f:
        for morceau in iter(lambda: f.read(1 << 20), b""):
            h.update(morceau)
    return h.hexdigest()


def fiche(url):
    """Writes the pack entry of catalogue/packs-odin.json for the ZIM just built (out/fiche.json)."""
    with open(os.path.join(SORTIE, "fiche.json"), encoding="utf-8") as f:
        f_zim = json.load(f)
    if not url.startswith("https://") or not url.endswith("/" + f_zim["fichier"]):
        raise SystemExit(f"Adresse inattendue pour {f_zim['fichier']} : {url}")
    try:
        with open(CATALOGUE, encoding="utf-8") as f:
            cat = json.load(f)
    except FileNotFoundError:
        cat = {"packs": []}
    entree = {**FICHE, **{k: v for k, v in f_zim.items() if k != "fichier"}, "url": url}
    cat["packs"] = [p for p in cat["packs"] if p.get("id") != FICHE["id"]] + [entree]
    with open(CATALOGUE, "w", encoding="utf-8") as f:
        json.dump(cat, f, ensure_ascii=False, indent=2)
        f.write("\n")
    journal(f"Catalogue : {FICHE['id']} → {url} ({entree['taille']} octets, {entree['date']})")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("commande", choices=["recuperer", "construire", "tout", "fiche"])
    ap.add_argument("--complet", action="store_true", help="relire tous les articles, pas seulement les modifiés")
    ap.add_argument("--url", help="adresse de téléchargement du ZIM publié (commande fiche)")
    a = ap.parse_args()
    if a.commande == "fiche":
        if not a.url:
            ap.error("--url est obligatoire")
        return fiche(a.url)
    if a.commande in ("recuperer", "tout"):
        recuperer(a.complet)
    if a.commande in ("construire", "tout"):
        construire()


if __name__ == "__main__":
    sys.exit(main())

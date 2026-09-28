#!/usr/bin/env python3
"""NoPanic articles -> ZIM pack for ODIN.

  python nopanic.py recuperer [--rafraichir]   API + images, polite and cached (network)
  python nopanic.py construire                 ZIM from the cache only (no network)
  python nopanic.py tout [--rafraichir]        both

The cache (.cache/) is never downloaded twice; --rafraichir only re-reads the
API listings (categories, posts), never an image already cached.
"""
import argparse
import html
import io
import json
import os
import sys
import time
from datetime import date, datetime
from urllib.parse import quote, unquote, urlsplit

from nettoyage import Nettoyeur
from reseau import CACHE, ICI, HorsLigne, Reseau

SITE = "https://nopanic.fr"
API = SITE + "/wp-json/wp/v2"
RUBRIQUES = ["outdoor", "autonomie", "low-tech", "survivaliste-prepper"]
CHAMPS_POSTS = "id,date,modified,slug,link,title,content,categories"
SORTIE = os.path.join(ICI, "out")
NOM = "nopanic_fr_articles"
LOGO = SITE + "/wp-content/uploads/2021/09/np-logo-simple.png"
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
def lire_categories(reseau, rafraichir):
    cats, page = [], 1
    while True:
        meta, j = reseau.json(f"{API}/categories?per_page=100&page={page}&_fields=id,name,slug,parent,count,link",
                              rafraichir=rafraichir)
        cats += j
        if page >= int(meta.get("pages") or 1):
            return cats
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


def lire_articles(reseau, ids, rafraichir):
    posts, page = [], 1
    liste = ",".join(map(str, ids))
    while True:
        meta, j = reseau.json(f"{API}/posts?categories={liste}&per_page=100&page={page}"
                              f"&orderby=id&order=asc&_fields={CHAMPS_POSTS}", rafraichir=rafraichir)
        posts += j
        if page >= int(meta.get("pages") or 1):
            break
        page += 1
    # dedup by id (an article can sit in several categories)
    uniques = {}
    for p in posts:
        uniques.setdefault(p["id"], p)
    return list(uniques.values()), len(posts)


def logo_urls(reseau, rafraichir):
    meta, j = reseau.json(SITE + "/wp-json/?_fields=name,description,site_icon_url", rafraichir=rafraichir)
    return j.get("site_icon_url") or None


def preparer(reseau, rafraichir=False):
    cats = lire_categories(reseau, rafraichir)
    racines, ids = perimetre(cats)
    posts, bruts = lire_articles(reseau, ids, rafraichir)
    posts.sort(key=lambda p: p["date"], reverse=True)
    par_chemin, par_id = {}, {}
    for p in posts:
        chemin = unquote(urlsplit(p["link"]).path).strip("/")
        zim = unquote(p["slug"])
        par_chemin[chemin] = zim
        par_chemin.setdefault(zim, zim)
        par_id[p["id"]] = zim
    nettoyeur = Nettoyeur(par_chemin, par_id, set(par_chemin))
    return cats, racines, ids, posts, bruts, nettoyeur


def nettoyer_tout(posts, nettoyeur):
    images, rapports, corps = {}, {}, {}
    for p in posts:
        corps[p["id"]], rapports[p["id"]] = nettoyeur.nettoyer(p["content"]["rendered"], p["link"], images)
    return images, rapports, corps


# --- commands -------------------------------------------------------------
def recuperer(rafraichir):
    debut = time.monotonic()
    reseau = Reseau()
    cats, racines, ids, posts, bruts, nettoyeur = preparer(reseau, rafraichir)
    journal(f"{len(posts)} articles ({bruts} avant dédoublonnage), {len(ids)} catégories")
    images, _, _ = nettoyer_tout(posts, nettoyeur)
    icone = logo_urls(reseau, rafraichir)
    a_prendre = sorted(images) + [LOGO] + ([icone] if icone else [])
    deja = sum(1 for u in a_prendre if reseau.en_cache(u))
    journal(f"{len(a_prendre)} images, {deja} déjà en cache")
    echecs = []
    for n, url in enumerate(a_prendre, 1):
        if reseau.en_cache(url):
            continue
        try:
            reseau.get(url)
        except Exception as e:
            echecs.append({"url": url, "erreur": str(e)})
            journal(f"  échec {url} : {e}")
        if n % 100 == 0:
            journal(f"  {n}/{len(a_prendre)} ({reseau.requetes} requêtes, {reseau.octets / 1e6:.1f} Mo)")
    duree = time.monotonic() - debut
    os.makedirs(SORTIE, exist_ok=True)
    etat = {"date": datetime.now().isoformat(timespec="seconds"), "duree_s": round(duree),
            "requetes": reseau.requetes, "octets": reseau.octets, "echecs_images": echecs}
    with open(os.path.join(SORTIE, "recuperation.json"), "w", encoding="utf-8") as f:
        json.dump(etat, f, ensure_ascii=False, indent=1)
    journal(f"Récupération terminée en {duree:.0f} s : {reseau.requetes} requêtes, "
            f"{reseau.octets / 1e6:.1f} Mo, {len(echecs)} échec(s)")


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
            morceaux.append(f"<h{niveau}>{html.escape(texte(c['name']))} <span class=\"nb\">({n})</span></h{niveau}>"
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
    try:
        cats, racines, ids, posts, bruts, nettoyeur = preparer(reseau)
    except HorsLigne as e:
        raise SystemExit(f"Cache incomplet, lancer d'abord « recuperer » : {e}")
    images, rapports, corps = nettoyer_tout(posts, nettoyeur)

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
    mois = date.today().strftime("%Y-%m")
    zim = os.path.join(SORTIE, f"{NOM}_{mois}.zim")
    if os.path.exists(zim):
        os.remove(zim)

    manquantes, poids, presentes = [], 0, 0
    icone_url = logo_urls(reseau, False)
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
                         ("Flavour", "maxi")]:
            c.add_metadata(cle, val)
        if icone_url and reseau.en_cache(icone_url):
            _, octets = reseau.get(icone_url)
            im = Image.open(io.BytesIO(octets)).convert("RGBA").resize((48, 48), Image.LANCZOS)
            tampon = io.BytesIO()
            im.save(tampon, "PNG")
            c.add_illustration(48, tampon.getvalue())
        if reseau.en_cache(logo_url):
            logo = "logo-nopanic.png"
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
        "elements_retires": sorted({x for r in rapports.values() for x in r["retires"]}),
        "articles_vides": [p["link"] for p in posts if not corps[p["id"]].strip()],
        "duree_construction_s": round(time.monotonic() - debut),
    }
    with open(os.path.join(SORTIE, "rapport.json"), "w", encoding="utf-8") as f:
        json.dump(rapport, f, ensure_ascii=False, indent=1)
    journal(json.dumps({k: v for k, v in rapport.items() if k not in ("images_manquantes",)},
                       ensure_ascii=False, indent=1)[:3000])
    journal(f"{len(manquantes)} image(s) absente(s) du cache")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("commande", choices=["recuperer", "construire", "tout"])
    ap.add_argument("--rafraichir", action="store_true", help="relire les listes de l'API (nouveaux articles)")
    a = ap.parse_args()
    if a.commande in ("recuperer", "tout"):
        recuperer(a.rafraichir)
    if a.commande in ("construire", "tout"):
        construire()


if __name__ == "__main__":
    sys.exit(main())

"""Cleaning of a NoPanic article body (content.rendered of the WordPress API).

Structural cleaning only: the text of the article is never rewritten or cut.
Removed: scripts, iframes, forms, share blocks and widgets. Embedded videos
become a text link. Images are pointed to their local copy, links to other
included articles become internal links.
"""
import re
from urllib.parse import parse_qs, quote, unquote, urljoin, urlsplit

from bs4 import BeautifulSoup, Comment

HOTES_SITE = {"nopanic.fr", "www.nopanic.fr"}
LARGEUR_CIBLE = 1024
DOSSIER_IMAGES = "images/"

# Elements dropped with their content
A_RETIRER = ["script", "style", "noscript", "form", "input", "button", "select", "textarea",
             "link", "meta", "svg", "object", "embed", "canvas"]
# Class tokens of share blocks, widgets, newsletters, ads, affiliate or shop boxes
CLASSES_WIDGETS = re.compile(
    r"^(sharedaddy|sd-sharing.*|share.*|.*-share|social.*|jp-relatedposts.*|related.*|"
    r"newsletter.*|mailpoet.*|wpforms.*|mc4wp.*|addtoany.*|a2a.*|heateor.*|"
    r"adsbygoogle|advert.*|affili.*|aawp.*|lasso.*|woocommerce.*|penci-.*|"
    r"wp-block-buttons|wp-block-search|wp-block-latest-posts|wp-block-rss|"
    r"wp-block-social-links|wp-block-post-.*|wp-block-query.*)$")
ATTRIBUTS_GARDES = {
    "a": {"href", "title", "id"},
    "img": {"src", "alt", "width", "height", "title"},
    "td": {"colspan", "rowspan"}, "th": {"colspan", "rowspan", "scope"},
    "ol": {"start", "reversed", "type"}, "li": {"value"},
}
ATTRIBUTS_COMMUNS = {"id", "class"}
EXTENSIONS_IMAGES = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg")


def hote(url):
    return urlsplit(url).netloc.lower()


def du_site(url):
    return hote(url) in HOTES_SITE


def chemin_image(url):
    """ZIM path of a downloaded image (keeps the uploads/<year>/<month> tree)."""
    p = unquote(urlsplit(url).path)
    if "/wp-content/uploads/" in p:
        p = p.split("/wp-content/uploads/", 1)[1]
    else:
        p = p.lstrip("/")
    return DOSSIER_IMAGES + p


def choisir_image(img, base):
    """Pick one size: the srcset candidate closest to 1024 px wide, else src."""
    candidats = []
    for morceau in (img.get("srcset") or "").split(","):
        parts = morceau.strip().split()
        if len(parts) == 2 and parts[1].endswith("w") and parts[1][:-1].isdigit():
            candidats.append((int(parts[1][:-1]), urljoin(base, parts[0])))
    if candidats:
        # closest to the target; on a tie, the larger one
        largeur, url = min(candidats, key=lambda c: (abs(c[0] - LARGEUR_CIBLE), -c[0]))
        return url, largeur
    src = img.get("src") or img.get("data-src") or ""
    return (urljoin(base, src), None) if src else (None, None)


def lien_video(src):
    """Public page of an embedded video, and the provider name."""
    u = urlsplit(src if not src.startswith("//") else "https:" + src)
    h = u.netloc.lower()
    if "youtube" in h or "youtu.be" in h:
        m = re.search(r"/embed/([^/?#]+)", u.path)
        if m and m.group(1) != "videoseries":
            return f"https://www.youtube.com/watch?v={m.group(1)}", "YouTube"
        liste = parse_qs(u.query).get("list")
        if liste:
            return f"https://www.youtube.com/playlist?list={liste[0]}", "YouTube"
        return u.geturl(), "YouTube"
    if "vimeo" in h:
        m = re.search(r"/video/(\d+)", u.path)
        return (f"https://vimeo.com/{m.group(1)}" if m else u.geturl()), "Vimeo"
    if "dailymotion" in h:
        m = re.search(r"/video/([^/?#]+)", u.path) or re.search(r"/embed/video/([^/?#]+)", u.path)
        return (f"https://www.dailymotion.com/video/{m.group(1)}" if m else u.geturl()), "Dailymotion"
    return None, None


class Nettoyeur:
    def __init__(self, articles_par_chemin, articles_par_id, slugs):
        # site path ("slug") -> ZIM path, post id -> ZIM path, slug set
        self.par_chemin = articles_par_chemin
        self.par_id = articles_par_id
        self.slugs = slugs

    def article_interne(self, url):
        """ZIM path of an included article targeted by url, else None."""
        u = urlsplit(url)
        if u.netloc.lower() not in HOTES_SITE:
            return None
        chemin = unquote(u.path).strip("/")
        if chemin in self.par_chemin:
            return self.par_chemin[chemin]
        p = parse_qs(u.query).get("p")
        if not chemin and p and p[0].isdigit() and int(p[0]) in self.par_id:
            return self.par_id[int(p[0])]
        segments = chemin.split("/")
        # old date-based permalinks: /2013/03/<slug>/
        if len(segments) > 1 and all(s.isdigit() for s in segments[:-1]) and segments[-1] in self.slugs:
            return self.par_chemin[segments[-1]]
        return None

    def nettoyer(self, html, base, images):
        """Return (clean html, report). images: dict url -> ZIM path, filled here."""
        s = BeautifulSoup(html, "html.parser")
        r = {"retires": [], "videos": [], "integres": [], "images_externes": [], "liens_internes": 0}

        for c in s.find_all(string=lambda t: isinstance(t, Comment)):
            c.extract()

        # Instagram and similar embeds: a link to the original post
        for bq in s.select("blockquote.instagram-media, blockquote.twitter-tweet, blockquote.tiktok-embed"):
            lien = bq.get("data-instgrm-permalink") or bq.get("cite") or (bq.find("a", href=True) or {}).get("href")
            nom = "Instagram" if "instagram" in " ".join(bq.get("class")) else "réseau social"
            r["integres"].append(lien)
            bq.replace_with(self._paragraphe_lien(s, lien, f"Publication {nom} (voir en ligne)"))

        # Iframes: videos become a link to their page, other embeds (maps...) a link too
        for f in s.find_all("iframe"):
            src = urljoin(base, f.get("src") or f.get("data-src") or "")
            page, fournisseur = lien_video(src)
            titre = f.get("title")
            if page:
                texte = f"Vidéo {fournisseur}" + (f" : {titre}" if titre else "") + " (voir en ligne)"
                r["videos"].append(page)
            else:
                page = src
                texte = f"Contenu intégré ({hote(src) or 'externe'}) : voir en ligne"
                r["integres"].append(src)
            cible = f.find_parent("div", class_="wp-block-embed__wrapper") or f
            cible.replace_with(self._paragraphe_lien(s, page, texte))
        for v in s.find_all(["video", "audio"]):
            src = v.get("src") or (v.find("source") or {}).get("src")
            src = urljoin(base, src) if src else None
            r["videos"].append(src)
            texte = ("Vidéo" if v.name == "video" else "Son") + " (voir en ligne)"
            v.replace_with(self._paragraphe_lien(s, src, texte) if src else "")

        # Oembed wrappers left with only a bare URL: keep the URL as a link
        for w in s.select("div.wp-block-embed__wrapper"):
            texte = w.get_text(strip=True)
            if texte.startswith("http") and not w.find(True):
                w.replace_with(self._paragraphe_lien(s, texte, texte))

        for t in s.find_all(A_RETIRER):
            r["retires"].append(t.name)
            t.decompose()
        for t in s.find_all(True):
            if t.decomposed:
                continue
            if any(CLASSES_WIDGETS.match(c) for c in t.get("class") or []):
                r["retires"].append("." + ".".join(t.get("class")))
                t.decompose()

        # Images: one size, local path
        for img in s.find_all("img"):
            url, largeur = choisir_image(img, base)
            if not url or url.startswith("data:"):
                img.decompose()
                continue
            if not du_site(url):
                r["images_externes"].append(url)
                img["src"] = url  # listed apart, left on the web
            else:
                chemin = chemin_image(url)
                images[url] = chemin
                if largeur and img.get("width") and img.get("height"):
                    try:
                        ratio = int(img["height"]) / int(img["width"])
                        img["width"], img["height"] = str(largeur), str(round(largeur * ratio))
                    except (ValueError, ZeroDivisionError):
                        pass
                img["src"] = quote(chemin)
            parent = img.parent
            # a link around the image to the full-size file: point it to the local copy
            if parent.name == "a" and parent.get("href") and du_site(urljoin(base, parent["href"])) \
                    and urlsplit(parent["href"]).path.lower().endswith(EXTENSIONS_IMAGES):
                parent["href"] = img["src"]
                parent["data-image"] = "1"

        # Links
        for a in s.find_all("a", href=True):
            if a.get("data-image"):
                del a["data-image"]
                continue
            h = a["href"].strip()
            if h.startswith("#") or h.startswith("mailto:"):
                continue
            absolu = urljoin(base, h)
            interne = self.article_interne(absolu)
            if interne:
                frag = urlsplit(absolu).fragment
                a["href"] = quote(interne) + (f"#{frag}" if frag else "")
                r["liens_internes"] += 1
            else:
                a["href"] = absolu

        # Attributes: keep structure only (no style, srcset, data-*, event handlers)
        for t in s.find_all(True):
            gardes = ATTRIBUTS_GARDES.get(t.name, set()) | ATTRIBUTS_COMMUNS
            for att in list(t.attrs):
                if att not in gardes:
                    del t[att]
        return str(s).strip(), r

    @staticmethod
    def _paragraphe_lien(s, url, texte):
        p = s.new_tag("p", attrs={"class": "lien-integre"})
        a = s.new_tag("a", href=url or "#")
        a.string = "▶ " + texte
        p.append(a)
        return p

"""Polite, cached HTTP access to nopanic.fr.

- one request at a time, at least DELAI seconds between two requests
- robots.txt read once and obeyed
- every successful response is kept in .cache/ and never downloaded again
"""
import hashlib
import json
import os
import time
import urllib.robotparser
from urllib.parse import urlsplit

import requests

UA = "ODIN-offline-pack (+https://github.com/Gorgo126/ODIN)"
DELAI = 1.1          # seconds between two requests (minimum asked: 1 s)
TIMEOUT = (15, 60)   # connect, read

ICI = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ICI, ".cache")


class HorsLigne(Exception):
    """Raised when a resource is missing from the cache in offline mode."""


class Reseau:
    def __init__(self, hors_ligne=False):
        self.hors_ligne = hors_ligne
        self.session = requests.Session()
        self.session.headers["User-Agent"] = UA
        self.dernier = 0.0
        self.robots = {}
        self.requetes = 0
        self.octets = 0
        os.makedirs(os.path.join(CACHE, "http"), exist_ok=True)

    # --- cache -----------------------------------------------------------
    @staticmethod
    def _chemin(url):
        h = hashlib.sha256(url.encode()).hexdigest()
        return os.path.join(CACHE, "http", h[:2], h)

    def en_cache(self, url):
        return os.path.exists(self._chemin(url) + ".meta")

    def _lire_cache(self, url):
        base = self._chemin(url)
        with open(base + ".meta", encoding="utf-8") as f:
            meta = json.load(f)
        with open(base + ".body", "rb") as f:
            return meta, f.read()

    def _ecrire_cache(self, url, meta, corps):
        base = self._chemin(url)
        os.makedirs(os.path.dirname(base), exist_ok=True)
        # body first, meta last: a .meta file always means a complete entry
        with open(base + ".body.part", "wb") as f:
            f.write(corps)
        os.replace(base + ".body.part", base + ".body")
        with open(base + ".meta.part", "w", encoding="utf-8") as f:
            json.dump(meta, f)
        os.replace(base + ".meta.part", base + ".meta")

    # --- politeness ------------------------------------------------------
    def _attendre(self):
        reste = self.dernier + DELAI - time.monotonic()
        if reste > 0:
            time.sleep(reste)

    def _autorise(self, url):
        p = urlsplit(url)
        hote = f"{p.scheme}://{p.netloc}"
        if hote not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                meta, corps = self.get(hote + "/robots.txt", verifier_robots=False, accepter=(200, 404),
                                      garder=False)
                rp.parse(corps.decode("utf-8", "replace").splitlines() if meta["status"] == 200 else [])
            except Exception:
                # robots.txt unreachable: be conservative, allow nothing on that host
                rp.parse(["User-agent: *", "Disallow: /"])
            self.robots[hote] = rp
        return self.robots[hote].can_fetch(UA, url)

    # --- public ----------------------------------------------------------
    def get(self, url, verifier_robots=True, accepter=(200,), essais=3, rafraichir=False, garder=True):
        """Return (meta, body). meta = {status, type, headers subset}.

        rafraichir=True downloads again even if cached. garder=False neither reads nor
        writes the cache (API listings and robots.txt, whose content changes; images
        never change under the same URL)."""
        if garder and self.en_cache(url) and not (rafraichir and not self.hors_ligne):
            return self._lire_cache(url)
        if self.hors_ligne:
            raise HorsLigne(url)
        if verifier_robots and not self._autorise(url):
            raise PermissionError(f"interdit par robots.txt : {url}")
        derniere = None
        for n in range(essais):
            self._attendre()
            try:
                r = self.session.get(url, timeout=TIMEOUT)
                self.dernier = time.monotonic()
                self.requetes += 1
            except requests.RequestException as e:
                self.dernier = time.monotonic()
                derniere = e
                time.sleep(5 * (n + 1))
                continue
            if r.status_code in (429, 500, 502, 503, 504):
                derniere = RuntimeError(f"HTTP {r.status_code} {url}")
                time.sleep(int(r.headers.get("Retry-After", "0") or 0) or 10 * (n + 1))
                continue
            if r.status_code not in accepter:
                raise RuntimeError(f"HTTP {r.status_code} {url}")
            meta = {
                "url": url,
                "final": r.url,
                "status": r.status_code,
                "type": r.headers.get("Content-Type", ""),
                "total": r.headers.get("X-WP-Total"),
                "pages": r.headers.get("X-WP-TotalPages"),
                "date": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            }
            self.octets += len(r.content)
            if garder:
                self._ecrire_cache(url, meta, r.content)
            return meta, r.content
        raise derniere

    def ajouter(self, url, meta, corps):
        """Put a resource found elsewhere (previous ZIM) into the cache."""
        self._ecrire_cache(url, meta, corps)

    def json(self, url, rafraichir=False, garder=True):
        meta, corps = self.get(url, rafraichir=rafraichir, garder=garder)
        return meta, json.loads(corps)

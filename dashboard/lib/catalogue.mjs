import { promises as fs } from 'fs';
import { ecrireJson, lireJson } from './fichiers.mjs';

const OPDS = 'https://library.kiwix.org/catalog/v2/entries';
const CATALOGUE = '/catalogue/packs.txt';
// Whole OPDS catalogue, read in one request and kept 1 h (1 min after a failure), shared by all packs
const cache = globalThis.__odinOpdsCatalogue ??= { t: 0, v: null, p: null };
const DUREE = 3600000;
const DUREE_ECHEC = 60000;
// Last size read in the catalogue for each pack, kept on disk so that it can be shown offline
const MESURES = '/data/tailles.json';
const memoire = globalThis.__odinTaillesZim ??= { valeurs: null };

export async function dernieresTailles() {
  memoire.valeurs ??= await lireJson(MESURES, {});
  return memoire.valeurs;
}

async function memoriser(id, taille) {
  const m = await dernieresTailles();
  if (!taille || m[id] === taille) return;
  m[id] = taille;
  await ecrireJson(MESURES, m).catch(() => {});
}

// Uninstalled pack: its last size is forgotten too
export async function oublierTaille(id) {
  const m = await dernieresTailles();
  if (!(id in m)) return;
  delete m[id];
  await ecrireJson(MESURES, m).catch(() => {});
}

const decoder = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const balise = (bloc, nom) => {
  const m = bloc.match(new RegExp(`<${nom}>([\\s\\S]*?)</${nom}>`));
  return m ? decoder(m[1].trim()) : '';
};

export async function lirePacks() {
  const texte = await fs.readFile(CATALOGUE, 'utf8');
  return texte.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [id, nom, variante, libelle] = l.split('|');
      return { id, nom, variante, libelle };
    });
}

const entree = (b) => {
  const lien = b.match(/<link[^>]*acquisition\/open-access[^>]*>/)?.[0] || '';
  return {
    uuid: balise(b, 'id').replace('urn:uuid:', ''),
    titre: balise(b, 'title'),
    description: balise(b, 'summary'),
    langue: balise(b, 'language'),
    nom: balise(b, 'name'),
    variante: balise(b, 'flavour'),
    tags: balise(b, 'tags'),
    date: balise(b, 'updated').slice(0, 10),
    articles: parseInt(balise(b, 'articleCount') || '0', 10),
    medias: parseInt(balise(b, 'mediaCount') || '0', 10),
    createur: decoder(b.match(/<author>\s*<name>([\s\S]*?)<\/name>/)?.[1] || ''),
    editeur: decoder(b.match(/<dc:publisher>\s*<name>([\s\S]*?)<\/name>/)?.[1] || ''),
    url: lien.match(/href="([^"]*)"/)?.[1] || '',
    taille: parseInt(lien.match(/length="(\d+)"/)?.[1] || '0', 10)
  };
};

// The API filters on one name only: the whole catalogue (about 450 KB compressed) is cheaper
// than one request per pack. Entries grouped by name; null when the catalogue is unreachable.
async function catalogue() {
  if (Date.now() - cache.t < (cache.v ? DUREE : DUREE_ECHEC)) return cache.v;
  // Concurrent callers (one per pack) share the same request
  cache.p ??= (async () => {
    let v = null;
    try {
      const r = await fetch(`${OPDS}?count=-1`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        v = new Map();
        for (const [, b] of (await r.text()).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
          const e = entree(b);
          if (e.url) v.set(e.nom, [...(v.get(e.nom) || []), e]);
        }
      }
    } catch (e) {
      console.error(`Catalogue Kiwix injoignable : ${e.message}`);
    }
    Object.assign(cache, { t: Date.now(), v, p: null });
    return v;
  })();
  return cache.p;
}

export async function infos(pack) {
  const tout = await catalogue();
  if (!tout) return null;
  const liste = tout.get(pack.nom) || [];
  const e = liste.find((e) => pack.variante === '-' || e.variante === pack.variante) || null;
  if (e) await memoriser(pack.id, e.taille);
  return e;
}

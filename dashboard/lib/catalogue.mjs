import { promises as fs } from 'fs';
import { ecrireJson, lireJson } from './fichiers.mjs';

const OPDS = 'https://library.kiwix.org/catalog/v2/entries';
const CATALOGUE = '/catalogue/packs.txt';
// Packs built and published by ODIN itself (GitHub Releases), outside the Kiwix catalogue: their
// entry carries everything (address, size, SHA-256), so nothing is asked to the network before a download
const CATALOGUE_ODIN = '/catalogue/packs-odin.json';
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

// Entry of packs-odin.json: kept only when complete and consistent (its file must carry the Kiwix
// name <nom>_<variante>_…, by which ODIN finds the files of a pack)
export function entreeOdin(p) {
  let fichier = '';
  try { fichier = typeof p?.url === 'string' ? decodeURIComponent(p.url.split('/').pop() || '') : ''; } catch {}
  const ok = !!p && /^[a-z0-9-]+$/.test(p.id) && /^[a-z0-9_-]+$/.test(p.nom) && /^[a-z0-9-]+$/.test(p.variante)
    && typeof p.libelle === 'string' && typeof p.url === 'string' && p.url.startsWith('https://')
    && /^[0-9a-f]{64}$/.test(p.sha256)
    && Number.isSafeInteger(p.taille) && p.taille > 0 && fichier.startsWith(`${p.nom}_${p.variante}_`)
    && fichier.endsWith('.zim');
  if (!ok) console.error(`packs-odin.json : entrée ignorée (${p?.id || 'sans identifiant'})`);
  return ok;
}

export async function lirePacks() {
  const texte = await fs.readFile(CATALOGUE, 'utf8');
  const kiwix = texte.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [id, nom, variante, libelle] = l.split('|');
      return { id, nom, variante, libelle, source: 'kiwix' };
    });
  const odin = ((await lireJson(CATALOGUE_ODIN, { packs: [] }))?.packs || [])
    .filter(entreeOdin)
    .filter((p) => !kiwix.some((k) => k.id === p.id))
    .map((p) => ({ id: p.id, nom: p.nom, variante: p.variante, libelle: p.libelle, source: 'odin', fiche: p }));
  return [...kiwix, ...odin];
}

// Same shape as an entry of the Kiwix catalogue, plus the SHA-256 checked after the download
export const entreeFiche = (f) => ({
  uuid: f.uuid || '', titre: f.titre || f.libelle, description: f.description || '', langue: f.langue || '',
  nom: f.nom, variante: f.variante, tags: f.tags || '', date: f.date || '', articles: f.articles || 0,
  medias: f.medias || 0, createur: f.createur || '', editeur: f.editeur || '', url: f.url, taille: f.taille,
  sha256: f.sha256
});

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
  if (pack.source === 'odin') {
    const e = entreeFiche(pack.fiche);
    await memoriser(pack.id, e.taille);
    return e;
  }
  const tout = await catalogue();
  if (!tout) return null;
  const liste = tout.get(pack.nom) || [];
  const e = liste.find((e) => pack.variante === '-' || e.variante === pack.variante) || null;
  if (e) await memoriser(pack.id, e.taille);
  return e;
}

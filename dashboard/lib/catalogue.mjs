import { promises as fs } from 'fs';

const OPDS = 'https://library.kiwix.org/catalog/v2/entries';
const CATALOGUE = '/catalogue/packs.txt';
const cache = globalThis.__odinOpds ??= new Map();
const sonde = globalThis.__odinSonde ??= { t: 0, ok: false };

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

// One quick probe before the per-pack queries: offline, the page answers in 2 s at most
export async function catalogueJoignable() {
  if (Date.now() - sonde.t < (sonde.ok ? 600000 : 60000)) return sonde.ok;
  let ok = false;
  try {
    ok = (await fetch(`${OPDS}?count=1`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {}
  sonde.t = Date.now();
  sonde.ok = ok;
  return ok;
}

async function entrees(nom) {
  const c = cache.get(nom);
  if (c && Date.now() - c.t < (c.v ? 600000 : 60000)) return c.v;
  let v = null;
  try {
    const r = await fetch(`${OPDS}?name=${encodeURIComponent(nom)}&count=20`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const xml = await r.text();
      v = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, b]) => {
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
      }).filter((e) => e.url);
    }
  } catch {}
  cache.set(nom, { t: Date.now(), v });
  return v;
}

export async function infos(pack) {
  const liste = await entrees(pack.nom);
  if (!liste) return null;
  return liste.find((e) => pack.variante === '-' || e.variante === pack.variante) || null;
}

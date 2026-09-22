import { promises as fs } from 'fs';
import path from 'path';
import { normaliser } from '../lib/normalisation.mjs';
import { termes } from './bm25.mjs';

// « Livres » source of the assistant: installed PDF books, through the text already extracted page
// by page (data/livres/<id>/pages.json). The pages richest in the query words give their paragraphs.

const DOSSIER = '/livres';
const MIN_PARAGRAPHE = 60;
const cache = new Map(); // id → { cle, titre, pages }

async function charger() {
  const noms = (await fs.readdir(DOSSIER).catch(() => [])).filter((n) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(n));
  for (const id of cache.keys()) if (!noms.includes(id)) cache.delete(id);
  const livres = await Promise.all(noms.map(async (id) => {
    try {
      const fichier = path.join(DOSSIER, id, 'pages.json');
      const s = await fs.stat(fichier);
      const cle = s.mtimeMs;
      let l = cache.get(id);
      if (l?.cle !== cle) {
        const fiche = JSON.parse(await fs.readFile(path.join(DOSSIER, id, 'fiche.json'), 'utf8'));
        const pages = JSON.parse(await fs.readFile(fichier, 'utf8'));
        // A health book (« Là où il n'y a pas de docteur ») is a guide: it can help when no one else can
        l = { cle, id, titre: fiche.titre || id, guide: fiche.avertissement === 'sante', pages: pages.map((p) => ({ ...p, norm: normaliser(p.texte) })) };
        cache.set(id, l);
      }
      return l;
    } catch {
      return null; // book being installed, or without its text yet
    }
  }));
  return livres.filter(Boolean);
}

export async function passagesLivres(requetes, { pages = 5 } = {}) {
  const mots = termes(requetes);
  if (!mots.length) return [];
  const candidates = [];
  for (const l of await charger()) {
    for (const p of l.pages) {
      // Distinct words found count most, then their occurrences
      let distincts = 0;
      let total = 0;
      for (const m of mots) {
        const k = p.norm.split(m).length - 1;
        if (k) { distincts++; total += Math.min(k, 10); }
      }
      if (distincts) candidates.push({ l, p, score: distincts * 100 + total });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const terme = requetes.filter(Boolean).at(-1) || '';
  return candidates.slice(0, pages).flatMap(({ l, p }) => p.texte
    .split(/\n\s*\n/)
    .map((t) => t.replace(/\s*\n\s*/g, ' ').trim())
    .filter((t) => t.length >= MIN_PARAGRAPHE)
    .map((t) => ({
      origine: 'livre',
      source: l.titre,
      guide: l.guide,
      titre: l.titre,
      section: p.chapitre || '',
      page: p.page,
      texte: t,
      lien: `/livres/${l.id}?page=${p.page}&q=${encodeURIComponent(terme)}`
    })));
}

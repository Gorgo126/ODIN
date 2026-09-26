import { normaliser, positions } from '../lib/normalisation.mjs';
import { lireIndex, lienArticle } from '../lib/guides-index.mjs';
import { termes } from './bm25.mjs';

// « Comment faire ? » source of the advanced search and the assistant: the articles installed from
// odin-node.com, through the text built at installation (guides.json, one entry per h2 section). The
// sections richest in the query words give their paragraphs, as for the books. Read again when the
// installed version changes: an installation, an update or a removal is seen at the next question.

const MIN_PARAGRAPHE = 60;
const memo = { index: null, sections: [] };

function sections(index) {
  if (memo.index !== index) {
    memo.index = index;
    memo.sections = index.articles.flatMap((a) => a.sections.map((s) => ({ a, s, norm: normaliser(`${s.titre} ${s.texte}`) })));
  }
  return memo.sections;
}

export async function passagesGuides(requetes, { sections: nombre = 5 } = {}) {
  const mots = termes(requetes);
  const index = await lireIndex();
  if (!mots.length || !index) return [];
  const candidates = [];
  for (const x of sections(index)) {
    let distincts = 0;
    let total = 0;
    // Words counted from their start only: « sonne » must not match « personne »
    for (const m of mots) {
      const k = positions(x.norm, m, 10).length;
      if (k) { distincts++; total += Math.min(k, 10); }
    }
    if (distincts) candidates.push({ ...x, score: distincts * 100 + total });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, nombre).flatMap(({ a, s }) => s.texte
    .split(/\n\s*\n/)
    .map((t) => t.replace(/\s*\n\s*/g, ' ').trim())
    .filter((t) => t.length >= MIN_PARAGRAPHE)
    .map((t) => ({
      origine: 'comment-faire',
      source: 'Comment faire ?',
      // First-aid articles are a guide for emergencies, like the health books
      guide: a.category === 'sante',
      titre: a.title,
      section: s.titre,
      texte: t,
      lien: lienArticle(a)
    })));
}

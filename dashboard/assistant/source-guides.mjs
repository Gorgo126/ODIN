import { normaliser } from '../lib/normalisation.mjs';
import { lireIndex, lienArticle } from '../lib/guides-index.mjs';
import { termes, occurrences, clesUtiles } from './bm25.mjs';
import { peutEtreNom } from './lexique.mjs';

// « Comment faire ? » source of the advanced search and the assistant: the articles installed from
// odin-node.com, through the text built at installation (guides.json, one entry per h2 section). The
// sections richest in the query words give their paragraphs, as for the books. Read again when the
// installed version changes: an installation, an update or a removal is seen at the next question.

const MIN_PARAGRAPHE = 60;
const memo = { index: null, sections: [] };

function sections(index) {
  if (memo.index !== index) {
    memo.index = index;
    memo.sections = index.articles.flatMap((a) => {
      const cles = clesUtiles(a.keywords);
      return a.sections.map((s) => ({ a, s, norm: normaliser(`${s.titre} ${s.texte}`), cles }));
    });
  }
  return memo.sections;
}

// At most PAR_ARTICLE sections of one article among the candidates: an article whose keywords match
// has them in every section, and would otherwise take every place (seen: « coupure de courant »,
// 8 sections of the energy article, the two other relevant articles gone)
const PAR_ARTICLE = 2;

export async function passagesGuides(requetes, { sections: nombre = 6 } = {}) {
  const mots = termes(requetes);
  const index = await lireIndex();
  if (!mots.length || !index) return [];
  const candidates = [];
  for (const x of sections(index)) {
    let distincts = 0;
    let total = 0;
    // Words counted as the BM25 counts them (occurrences): « sonne » must not match « personne ».
    // Only the words that can carry a meaning make a section a candidate (« plus », « suis » are
    // everywhere); every word still counts in the occurrences, which break ties.
    for (const m of mots) {
      // The article's keywords (manifest) count as one occurrence in each of its sections
      const k = occurrences(x.norm, m) + (x.cles && peutEtreNom(m) ? occurrences(x.cles, m, 1) : 0);
      if (!k) continue;
      total += k;
      if (peutEtreNom(m)) distincts++;
    }
    if (distincts) candidates.push({ ...x, score: distincts * 100 + total });
  }
  candidates.sort((a, b) => b.score - a.score);
  const parArticle = new Map();
  const retenues = candidates.filter((c) => {
    const n = parArticle.get(c.a.slug) || 0;
    parArticle.set(c.a.slug, n + 1);
    return n < PAR_ARTICLE;
  });
  return retenues.slice(0, nombre).flatMap(({ a, s }) => s.texte
    .split(/\n\s*\n/)
    .map((t) => t.replace(/\s*\n\s*/g, ' ').trim())
    .filter((t) => t.length >= MIN_PARAGRAPHE)
    .map((t) => ({
      origine: 'comment-faire',
      source: 'Comment faire ?',
      // First-aid articles are a guide for emergencies, like the health books
      guide: a.category === 'sante',
      titre: a.title,
      // Synonyms of the article: in the BM25 and in the embedded text (assistant/index.mjs)
      ...(a.keywords?.length ? { motsCles: a.keywords } : {}),
      section: s.titre,
      texte: t,
      lien: lienArticle(a)
    })));
}

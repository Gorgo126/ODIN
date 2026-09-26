import { normaliser } from '../lib/normalisation.mjs';
import { lireIndex, lienArticle } from '../lib/guides-index.mjs';
import { termes, occurrences, clesUtiles } from './bm25.mjs';
import { peutEtreNom } from './lexique.mjs';
import { forme } from './synonymes.mjs';

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
      // Whole keywords, normalized (accents, case, punctuation) and padded, numbers KEPT: « appeler le
      // 112 » is a keyword even though none of its words can carry a meaning alone
      const phrases = (a.keywords || []).map(forme).filter((k) => k.trim().length >= 2);
      return a.sections.map((s) => ({ a, s, norm: normaliser(`${s.titre} ${s.texte}`), cles, phrases }));
    });
  }
  return memo.sections;
}

// At most PAR_ARTICLE sections of one article among the candidates: an article whose keywords match
// has them in every section, and would otherwise take every place (seen: « coupure de courant »,
// 8 sections of the energy article, the two other relevant articles gone)
export const PAR_ARTICLE = 2;

export async function passagesGuides(requetes, { sections: nombre = 6 } = {}) {
  const mots = termes(requetes);
  const index = await lireIndex();
  if (!mots.length || !index) return [];
  // A question made only of such words (« je suis perdu ») keeps them all
  const sens = mots.some(peutEtreNom) ? peutEtreNom : () => true;
  // Articles one of whose keywords is in the question, whole and as written (after normalization):
  // their sections come first, and their passages are marked for motsClesExacts() below
  const question = forme(requetes[0] || '');
  const exacts = new Set(sections(index).filter((x) => x.phrases.some((k) => question.includes(k))).map((x) => x.a.slug));
  const candidates = [];
  for (const x of sections(index)) {
    let distincts = 0;
    let total = 0;
    // Words counted as the BM25 counts them (occurrences): « sonne » must not match « personne ».
    // Only the words that can carry a meaning make a section a candidate (« plus », « suis » are
    // everywhere); every word still counts in the occurrences, which break ties.
    for (const m of mots) {
      // The article's keywords (manifest) count as one occurrence in each of its sections
      const k = occurrences(x.norm, m) + (x.cles && sens(m) ? occurrences(x.cles, m, 1) : 0);
      if (!k) continue;
      total += k;
      if (sens(m)) distincts++;
    }
    const exact = exacts.has(x.a.slug);
    if (distincts || exact) candidates.push({ ...x, score: (exact ? 100000 : 0) + distincts * 100 + total });
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
      ...(exacts.has(a.slug) ? { motCleExact: true } : {}),
      section: s.titre,
      texte: t,
      lien: lienArticle(a)
    })));
}

// A keyword matched whole: once the cosines are known, the best passage of that article comes first
// in its source and reaches « fort », unless the embedding clearly says otherwise (cosine below
// plancher). The raw cosine is untouched (the assistant's thresholds use it); only the adjustment
// changes, as for the title rules of bm25.mjs. passages: the external passages of the index.
export const PLANCHER_MOT_CLE = 0.25;
export function motsClesExacts(passages, fort, plancher = PLANCHER_MOT_CLE) {
  const guides = passages.filter((p) => p.origine === 'comment-faire' && p.cosinus != null);
  const note = (p) => p.cosinus + (p.ajustement || 0);
  const autres = guides.filter((p) => !p.motCleExact).map(note);
  const cible = Math.max(fort, autres.length ? Math.max(...autres) + 0.001 : -1);
  for (const p of guides) {
    if (!p.motCleExact || p.cosinus < plancher || note(p) >= cible) continue;
    // Rounded up, with a margin: cosine + adjustment must not fall a hair below the threshold
    p.ajustement = Math.ceil((cible - p.cosinus) * 1e4 + 1) / 1e4;
    p.regles = [...(p.regles || []), `mot-clé exact → ${cible.toFixed(3)}`];
  }
}

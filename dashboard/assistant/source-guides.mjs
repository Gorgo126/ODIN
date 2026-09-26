import { normaliser } from '../lib/normalisation.mjs';
import { lireIndex, lienArticle } from '../lib/guides-index.mjs';
import { termes, occurrences, clesUtiles } from './bm25.mjs';
import { peutEtreNom } from './lexique.mjs';
import { forme } from './synonymes.mjs';
import { motsUtiles } from './contexte.mjs';

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
      const phrases = analyserMotsCles(a.keywords);
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
  // Articles one of whose keywords is in the question, whole and as written (after normalization),
  // with the strength of the match (correspondance): a complete one puts their sections first
  const liees = new Map();
  for (const x of sections(index)) {
    if (liees.has(x.a.slug)) continue;
    const c = correspondance(requetes[0] || '', x.phrases);
    if (c) liees.set(x.a.slug, c);
  }
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
    const complet = liees.get(x.a.slug)?.niveau === 'complet';
    if (distincts || complet) candidates.push({ ...x, score: (complet ? 100000 : 0) + distincts * 100 + total });
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
      ...(liees.has(a.slug) ? { motCle: liees.get(a.slug) } : {}),
      section: s.titre,
      texte: t,
      lien: lienArticle(a)
    })));
}

// Whole keywords of an article, normalized (accents, case, punctuation) and padded, numbers KEPT
// (« appeler le 112 »): the phrase, its useful words (for the coverage of the question), and how
// many of them can carry a meaning on their own (nouns, and numbers: « 112 »)
const porteur = (m) => peutEtreNom(m) || /^\d+$/.test(m);
const racine = (m) => m.replace(/(es|s|x)$/, '');
const utiles = (texte) => {
  const tous = forme(texte).trim().split(' ').filter(Boolean);
  const u = motsUtiles(texte);
  return (u.length ? u : tous).map(racine);
};
export function analyserMotsCles(motsCles = []) {
  return motsCles
    .map((k) => ({ cle: k, phrase: forme(k), utiles: new Set(utiles(k)), sens: forme(k).trim().split(' ').filter(porteur).length }))
    .filter((k) => k.phrase.trim().length >= 2);
}

// Strength of the best keyword of an article found whole in the question, or null:
// - complet: the keyword has two meaningful words or more (« coupure de courant », « arrêt
//   cardiaque »), OR it covers two thirds at least of the useful words of the question (« appeler le
//   112 » for « appeler le 112 », « plus d'électricité » for « plus d'électricité »);
// - modere: a keyword that is only a part of the question (« soleil » in « coup de soleil »,
//   « savon » in « savon pour bébé », « batterie » in « batterie de voiture à plat »).
// plancher: cosine under which the embedding is taken as contradicting the keyword: 0.25 for a keyword
// of several meaningful words, 0.35 (the « close » threshold) when it rests on a single one.
export const COUVERTURE = 2 / 3;
export const PLANCHERS = { plusieurs: 0.25, unSeul: 0.35 };
export function correspondance(question, phrases) {
  const q = forme(question);
  const mots = utiles(question);
  let meilleure = null;
  for (const k of phrases) {
    if (!q.includes(k.phrase)) continue;
    const couverture = mots.length ? mots.filter((m) => k.utiles.has(m)).length / mots.length : 0;
    const niveau = k.sens >= 2 || couverture >= COUVERTURE ? 'complet' : 'modere';
    const c = { niveau, cle: k.cle, couverture: +couverture.toFixed(2), plancher: k.sens >= 2 ? PLANCHERS.plusieurs : PLANCHERS.unSeul };
    if (!meilleure || (niveau === 'complet' && meilleure.niveau !== 'complet') || (niveau === meilleure.niveau && k.phrase.length > forme(meilleure.cle).length)) meilleure = c;
  }
  return meilleure;
}

// Once the cosines are known (assistant/index.mjs). The raw cosine is untouched (the assistant's
// thresholds use it); only the adjustment changes, as for the title rules of bm25.mjs.
// - Complete match, cosine at or above its floor: the best passage of the article comes first in its
//   source and reaches « fort ». When several articles share the keyword, only the one with the best
//   cosine gets this; the others are treated as a moderate match.
// - Moderate match, cosine at or above its floor: +0.05, but the bonus alone never crosses « fort ».
export const BONUS_MODERE = 0.05;
export function motsClesExacts(passages, fort) {
  const guides = passages.filter((p) => p.origine === 'comment-faire' && p.cosinus != null);
  const note = (p) => p.cosinus + (p.ajustement || 0);
  const regle = (p, texte) => { p.regles = [...(p.regles || []), texte]; };
  const complets = guides.filter((p) => p.motCle?.niveau === 'complet' && p.cosinus >= p.motCle.plancher)
    .sort((a, b) => b.cosinus - a.cosinus);
  const gagnant = complets[0] || null;
  // Moderate matches first (they may raise the notes the winner must pass)
  for (const p of guides) {
    if (!p.motCle || p === gagnant || (gagnant && p.titre === gagnant.titre)) continue;
    const plancher = p.motCle.niveau === 'complet' ? PLANCHERS.unSeul : p.motCle.plancher;
    if (p.cosinus < plancher || note(p) >= fort) continue;
    const bonus = Math.min(BONUS_MODERE, fort - 0.001 - note(p));
    if (bonus <= 0) continue;
    p.ajustement = +((p.ajustement || 0) + bonus).toFixed(4);
    regle(p, `mot-clé « ${p.motCle.cle} » (modéré) +${bonus.toFixed(3)}`);
  }
  if (!gagnant) return;
  const autres = guides.filter((p) => p.titre !== gagnant.titre).map(note);
  const cible = Math.max(fort, autres.length ? Math.max(...autres) + 0.001 : -1);
  if (note(gagnant) >= cible) return;
  // Rounded up, with a margin: cosine + adjustment must not fall a hair below the threshold
  gagnant.ajustement = Math.ceil((cible - gagnant.cosinus) * 1e4 + 1) / 1e4;
  regle(gagnant, `mot-clé « ${gagnant.motCle.cle} » (complet) → ${cible.toFixed(3)}`);
}

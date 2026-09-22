import { normaliser, motsRequete } from '../lib/normalisation.mjs';

// BM25 over a handful of passages (paragraphs of wiki articles or book pages), to choose the few
// worth an embedding. Words of 5 letters or more also match longer forms (brûlure → brûlures).

const K1 = 1.2;
const B = 0.75;

export const termes = (requetes) => motsRequete(requetes.filter(Boolean).join(' '));

export function classer(passages, requetes, n) {
  const mots = termes(requetes);
  if (!mots.length || !passages.length) return [];
  const docs = passages.map((p) => normaliser(`${p.titre || ''} ${p.section || ''} ${p.texte}`).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const moyenne = docs.reduce((s, d) => s + d.length, 0) / docs.length;
  const compte = (d, m) => d.reduce((k, t) => k + (t === m || (m.length >= 5 && t.startsWith(m)) ? 1 : 0), 0);
  const frequences = docs.map((d) => mots.map((m) => compte(d, m)));
  const idf = mots.map((_, j) => {
    const nj = frequences.filter((f) => f[j] > 0).length;
    return Math.log(1 + (docs.length - nj + 0.5) / (nj + 0.5));
  });
  return passages
    .map((p, i) => ({
      p,
      score: frequences[i].reduce((s, f, j) => s + idf[j] * (f * (K1 + 1)) / (f + K1 * (1 - B + B * docs[i].length / moyenne)), 0)
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => ({ ...x.p, bm25: x.score }));
}

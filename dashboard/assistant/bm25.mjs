import { normaliser, motsRequete } from '../lib/normalisation.mjs';
import { CONSTANTES } from './constantes.mjs';

// BM25 over a handful of passages (paragraphs of wiki articles or book pages), to choose the few
// worth an embedding. Words of 5 letters or more also match longer forms (brûlure → brûlures).
// A passage under a section heading that holds query words gets a bonus (« Premiers soins » in the
// « Brûlure » article): the heading says what the paragraph is about better than its words.

const K1 = 1.2;
const B = 0.75;
const BONUS_SECTION = 0.5; // per query word found in the section heading
// Rules around the main term (assistant/terme.mjs). Without a sure term, none of them applies.
// The same rules in the FINAL order (by cosine), as small additions to it: an article whose title is
// exactly the term comes before its particular cases (« Fièvre » before « Fièvre récurrente »), and a
// general section before the others. The raw cosine stays apart: the thresholds of the assistant
// use it. Measured on both series (CLAUDE.md).
export const AJUSTEMENTS = { titreExact: 0.15, specialisation: -0.05, sectionGenerale: 0.03 };
const POIDS = {
  titreExact: 3,        // « Fièvre » for the term « fièvre »
  titreCommence: 1.8,   // « Fièvre jaune » : one more word at most
  specialisation: 2 / 3, // « Fièvre pourprée des montagnes Rocheuses », only if a general one exists
  sectionGenerale: 1.4  // section from the closed list of constantes.mjs
};
// A section from the closed list, or one that starts with it (« Premiers soins et traitement
// immédiat »); a heading that merely contains it does not count
const sectionGenerale = (section) => {
  const s = normaliser(section || '').replace(/\s+/g, ' ').trim();
  return CONSTANTES.sectionsGenerales.some((g) => s === g || s.startsWith(`${g} `));
};

// How the title of a passage relates to the main term
function rapportAuTerme(titre, terme) {
  const t = normaliser(titre || '').replace(/\s+/g, ' ').trim();
  if (!t || !terme) return { type: 'aucun', extras: [] };
  const motsTerme = terme.split(' ').filter(Boolean);
  const motsTitre = t.split(' ').filter(Boolean);
  const extras = motsTitre.filter((m) => !motsTerme.includes(m));
  if (t === terme) return { type: 'exact', extras };
  if (t.startsWith(`${terme} `)) return { type: extras.length <= 1 ? 'commence' : 'specialise', extras };
  return { type: t.includes(terme) ? 'specialise' : 'aucun', extras };
}

// Words of several queries: each one on its own (motsRequete keeps 8 words of 200 characters), then
// together, 16 at most
// Occurrences of a query word in a normalized text, counted as the BM25 below counts them: the whole
// word, or its start from 5 letters on (« eau » finds « eau » but not « eaux » ; « brulu » finds
// « brulure »). Never inside a word: « sonne » must not find « personne ». Shared by the book and
// « Comment faire ? » sources, so that every source picks its candidates the same way.
const LETTRE = /[\p{L}\p{N}]/u;
export function occurrences(texte, m, max = 10) {
  let k = 0;
  for (let i = texte.indexOf(m); i !== -1 && k < max; i = texte.indexOf(m, i + 1)) {
    if (i > 0 && LETTRE.test(texte[i - 1])) continue;
    if (m.length < 5 && LETTRE.test(texte[i + m.length] || '')) continue;
    k++;
  }
  return k;
}

export const termes = (requetes) => [...new Set(requetes.filter(Boolean).flatMap((r) => motsRequete(r)))].slice(0, 16);

// Long paragraphs (encyclopedias, books) are cut at a sentence end: every character costs time for
// the embedding and for the reading of the prompt on CPU
export function couper(texte, max = 700) {
  if (texte.length <= max) return texte;
  const debut = texte.slice(0, max);
  const fin = Math.max(debut.lastIndexOf('. '), debut.lastIndexOf('! '), debut.lastIndexOf('? '));
  return fin > max / 2 ? debut.slice(0, fin + 1) : `${debut.replace(/\s+\S*$/, '')} …`;
}

// secondaires: neighbouring terms (synonym table, « aussi »), counted at half weight
const POIDS_SECONDAIRE = 0.5;
export function classer(passages, requetes, n, { terme = null, secondaires = [] } = {}) {
  const principaux = termes(requetes);
  const mots = [...principaux, ...termes(secondaires).filter((m) => !principaux.includes(m))];
  const poids = mots.map((_, j) => (j < principaux.length ? 1 : POIDS_SECONDAIRE));
  if (!principaux.length || !passages.length) return [];
  // A general article among the candidates: only then is a specialised one pushed back
  const rapports = passages.map((p) => rapportAuTerme(p.titre, terme));
  const general = rapports.some((r) => r.type === 'exact' || r.type === 'commence');
  // motsCles: synonyms given by the source for its document (« Comment faire ? » keywords)
  const docs = passages.map((p) => normaliser(`${p.titre || ''} ${p.section || ''} ${p.texte} ${(p.motsCles || []).join(' ')}`).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const moyenne = docs.reduce((s, d) => s + d.length, 0) / docs.length;
  const compte = (d, m) => d.reduce((k, t) => k + (t === m || (m.length >= 5 && t.startsWith(m)) ? 1 : 0), 0);
  const frequences = docs.map((d) => mots.map((m) => compte(d, m)));
  const idf = mots.map((_, j) => {
    const nj = frequences.filter((f) => f[j] > 0).length;
    return poids[j] * Math.log(1 + (docs.length - nj + 0.5) / (nj + 0.5));
  });
  const enSection = (p) => {
    const s = normaliser(p.section || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return mots.filter((m) => s.some((t) => t === m || (m.length >= 5 && t.startsWith(m)))).length;
  };
  return passages
    .map((p, i) => {
      const brut = frequences[i].reduce((s, f, j) => s + idf[j] * (f * (K1 + 1)) / (f + K1 * (1 - B + B * docs[i].length / moyenne)), 0)
        * (1 + BONUS_SECTION * enSection(p));
      const r = rapports[i];
      const regles = [];
      let score = brut;
      let ajustement = 0;
      if (r.type === 'exact') { score *= POIDS.titreExact; ajustement += AJUSTEMENTS.titreExact; regles.push(`titre exact ×${POIDS.titreExact}`); }
      else if (r.type === 'commence') { score *= POIDS.titreCommence; regles.push(`titre commence ×${POIDS.titreCommence}`); }
      else if (r.type === 'specialise' && general && r.extras.length >= 2 && !r.extras.some((m) => mots.some((q) => q === m || (m.length >= 5 && m.startsWith(q))))) {
        score *= POIDS.specialisation;
        ajustement += AJUSTEMENTS.specialisation;
        regles.push(`cas particulier ×${POIDS.specialisation.toFixed(2)}`);
      }
      if (sectionGenerale(p.section)) { score *= POIDS.sectionGenerale; ajustement += AJUSTEMENTS.sectionGenerale; regles.push(`section générale ×${POIDS.sectionGenerale}`); }
      return { p, score, brut, regles, ajustement };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => ({ ...x.p, texte: couper(x.p.texte), bm25: x.score, bm25Brut: x.brut, regles: x.regles, ajustement: x.ajustement }));
}

// Share of the query found in a passage, weighted by rarity (idf over the given passages): 0 to 1,
// comparable across sources, unlike raw BM25 scores. Used to rank when there are no vectors.
export function noterCouverture(passages, requetes) {
  const mots = termes(requetes);
  if (!mots.length || !passages.length) return;
  const presents = passages.map((p) => {
    const d = new Set(normaliser(`${p.titre || ''} ${p.section || ''} ${p.texte} ${(p.motsCles || []).join(' ')}`).split(/[^\p{L}\p{N}]+/u).filter(Boolean));
    return mots.map((m) => d.has(m) || (m.length >= 5 && [...d].some((t) => t.startsWith(m))));
  });
  // A word found in no passage at all (« soigner », « comment ») says nothing about any of them:
  // it does not count
  const idf = mots.map((_, j) => {
    const nj = presents.filter((f) => f[j]).length;
    return nj ? Math.log(1 + (passages.length - nj + 0.5) / (nj + 0.5)) : 0;
  });
  const total = idf.reduce((s, v) => s + v, 0) || 1;
  passages.forEach((p, i) => { p.couverture = presents[i].reduce((s, ok, j) => s + (ok ? idf[j] : 0), 0) / total; });
}

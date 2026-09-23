import { motsUtiles, memeMot } from './contexte.mjs';
import { normaliser } from '../lib/normalisation.mjs';

// The « main term » of a question: the word or group of words the ranking rules lean on. It comes
// from the understanding step (field « terme »), and is only kept when every one of its words comes
// from the question itself — a term invented by the model is noise. Otherwise a deterministic
// fallback takes over: a title of the articles found that the question contains, then the rarest
// word of the question among the passages found. When none gives
// a sure answer, there is no main term at all, and no rule applies.

const FORME = /^[\p{L}][\p{L}\p{N}\s'’-]{1,39}$/u;

export function termeDuModele(terme, question) {
  const propose = String(terme || '').trim();
  if (!FORME.test(propose)) return null;
  const mots = motsUtiles(propose);
  const source = motsUtiles(question);
  if (!mots.length || !source.length) return null;
  return mots.every((m) => source.some((s) => memeMot(s, m))) ? propose : null;
}

// Rarest word of the question among the passages found: the one that tells them apart. A tie means
// no clear winner, so no term.
export function termeDeSecours(question, frequence) {
  const comptes = motsUtiles(question).map((m) => [m, frequence(m)]).filter(([, n]) => n > 0).sort((a, b) => a[1] - b[1]);
  if (!comptes.length) return null;
  if (comptes.length > 1 && comptes[0][1] === comptes[1][1]) return null;
  return comptes[0][0];
}

// Title of a wiki article found that the question contains word for word (« brûlure » in « comment
// soigner une brûlure », « perte de connaissance »): the longest one. Parentheses are ignored
// (« Syncope (médecine) »). Titles of one short word are too vague to count.
const forme = (s) => ` ${normaliser(String(s)).replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
export function termeDuTitre(question, titres) {
  const q = forme(question);
  const trouves = [...new Set(titres.map(forme))].filter((t) => t.trim().length >= 4 && q.includes(t));
  return trouves.sort((a, b) => b.length - a.length)[0]?.trim() || null;
}

export function termePrincipal(terme, question, frequence, titres = []) {
  const duModele = termeDuModele(terme, question);
  if (duModele) return { terme: normaliser(duModele), source: 'modèle' };
  const titre = termeDuTitre(question, titres);
  if (titre) return { terme: titre, source: 'titre' };
  const secours = termeDeSecours(question, frequence);
  return secours ? { terme: secours, source: 'repli' } : { terme: null, source: 'aucun' };
}

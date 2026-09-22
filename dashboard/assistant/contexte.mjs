import { normaliser } from '../lib/normalisation.mjs';

// When the previous exchange may be joined to the understanding step, and whether the rewritten
// query can be trusted. Fixed rules, never the model: a complete question must never be read
// through the one before it (« comment faire accoucher un bébé ? » after a question on fever).

// Words that carry no subject by themselves: articles, pronouns, prepositions, auxiliaries and the
// most common verbs of a question. What is left is taken for the subject of the question.
const OUTILS = new Set([
  'a', 'ai', 'as', 'au', 'aux', 'avec', 'avoir', 'c', 'ca', 'ce', 'ceci', 'cela', 'ces', 'cet', 'cette', 'ceux', 'celle', 'celles', 'celui',
  'combien', 'comme', 'comment', 'd', 'dans', 'de', 'des', 'donc', 'du', 'elle', 'elles', 'en', 'est', 'et', 'etais', 'etait', 'etre',
  'eux', 'faire', 'fais', 'fait', 'faut', 'il', 'ils', 'j', 'je', 'l', 'la', 'le', 'les', 'leur', 'lui', 'm', 'ma', 'mais', 'me', 'mes',
  'moi', 'mon', 'n', 'ne', 'nos', 'notre', 'nous', 'on', 'ont', 'ou', 'par', 'pas', 'peut', 'plus', 'pour', 'pourquoi', 'quand', 'que',
  'quel', 'quelle', 'quelles', 'quels', 'qui', 'quoi', 'sa', 'sais', 'sait', 'se', 'ses', 'si', 'son', 'sont', 'sur', 't', 'ta', 'te',
  'tes', 'toi', 'ton', 'tu', 'un', 'une', 'vos', 'votre', 'vous', 'y', 'alors', 'aussi', 'bien', 'encore', 'meme', 'tout', 'toute',
  // Catch-all nouns and adjectives: they never tell a question apart (« forte fièvre » → fièvre)
  'cas', 'facon', 'maniere', 'chose', 'truc', 'moment', 'fois', 'type', 'sorte', 'genre', 'exemple', 'besoin', 'probleme',
  'fort', 'forte', 'forts', 'fortes', 'grand', 'grande', 'petit', 'petite', 'gros', 'grosse', 'bon', 'bonne', 'mauvais', 'mauvaise',
  'nouveau', 'nouvelle', 'vieux', 'vieille', 'beau', 'belle', 'chaud', 'chaude', 'froid', 'froide', 'rapide', 'lent', 'lente',
  'grave', 'leger', 'legere', 'simple', 'difficile', 'important', 'importante', 'urgent', 'urgente', 'meilleur', 'pire', 'vrai', 'faux'
]);

// Pronouns and demonstratives that point at something said before
const SANS_REFERENT = /\b(ca|cela|ceci|celui|celle|ceux|celles|celui la|celle la|pareil|idem|le meme|la meme|ce truc|cette chose)\b/;
const DEBUTS = /^(et|donc|alors|pourquoi|et si|comment ca)\b/;

const mots = (s) => normaliser(String(s)).replace(/['’-]/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
export const motsUtiles = (s) => mots(s).filter((m) => m.length >= 3 && !OUTILS.has(m));

// The previous exchange is joined only when the question cannot stand on its own
export function besoinDeContexte(question) {
  const n = normaliser(String(question)).replace(/['’-]/g, ' ').replace(/\s+/g, ' ').trim();
  const tous = mots(question);
  if (tous.length < 5) return true;
  if (DEBUTS.test(n)) return true;
  if (SANS_REFERENT.test(n)) return true;
  // Nothing but function words: no subject of its own
  return motsUtiles(question).length === 0;
}

// Two words talk about the same thing when one begins the other (fièvre / fièvres), or when they
// share their first four letters (purifier / purification, brûlé / brûlure)
export const memeMot = (a, b) => a === b
  || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b))
  || (a.length >= 5 && b.length >= 5 && a.slice(0, 4) === b.slice(0, 4));

// A rewritten query that shares nothing with the question is a drift: it is thrown away
export function reformulationFiable(question, requete) {
  const source = motsUtiles(question);
  if (!source.length) return true;
  const reecrite = motsUtiles(requete);
  return reecrite.some((r) => source.some((s) => memeMot(s, r)));
}

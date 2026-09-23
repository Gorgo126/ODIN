import { grouper } from './passages.mjs';
import { signeDeGravite } from './securite.mjs';
import { motsUtiles } from './contexte.mjs';
import { comprendre } from './synonymes.mjs';
import { normaliser } from '../lib/normalisation.mjs';

// Advanced search, shared by the route (/api/recherche) and the evaluation: the synonym table
// understands the question, the index searches every source, the passages are grouped by document.
// No language model, no dependency on Next.

export const EXTRAITS = 16;
const MAX_REQUETES = 6; // Kiwix searches in parallel: the phrase, the search terms, single words

// Queries for Kiwix, the books and the keywords. Kiwix looks for all the words of a query together:
// « comment soigner une brûlure » finds nothing useful, « brûlure » finds the article. So the search
// terms of the table go alone, then the meaningful words of the question (the longest, as typed:
// Kiwix does not ignore accents), unless a search term already holds them.
export function preparer(question, { synonymes = true } = {}) {
  const c = synonymes ? comprendre(question) : { question, terme: null, cherche: [], aussi: [], themes: [], entrees: [] };
  const couverts = new Set(c.cherche.flatMap((t) => motsUtiles(t)));
  const utiles = new Set(motsUtiles(question));
  const seuls = [...new Set(question.split(/[^\p{L}\p{N}]+/u)
    .filter((m) => m.length >= 4 && utiles.has(normaliser(m)) && !couverts.has(normaliser(m))))]
    .sort((a, b) => b.length - a.length);
  return {
    comprehension: c,
    requetes: [question, ...c.cherche.slice(0, 3), ...seuls].slice(0, MAX_REQUETES),
    // The main term of the table is trusted as is; without it, the index finds one in the question
    terme: c.terme,
    termeSur: !!c.terme,
    secondaires: c.aussi,
    texteVecteur: c.cherche.length ? `${question} (${c.cherche.join(', ')})` : question
  };
}

// rechercher(question, options): Index.rechercher, directly or through the worker. reseau(): state
// of the network for the emergency banner (« disponible », « indisponible », « inconnu »).
export async function chercher({ question, rechercher, reglages, reseau, debug = false, synonymes = true }) {
  const urgence = signeDeGravite(question);
  // Asked at once, in parallel with the search: it never waits for a test
  const etatReseau = urgence && reseau ? Promise.resolve().then(reseau).catch(() => 'inconnu') : null;
  const p = preparer(question, { synonymes });
  const r = await rechercher(question, {
    n: EXTRAITS,
    sources: ['documents', 'wikis', 'livres'],
    requetes: p.requetes,
    terme: p.terme,
    termeSur: p.termeSur,
    secondaires: p.secondaires,
    texteVecteur: p.texteVecteur
  });
  const g = grouper(r, question, reglages, { urgence, debug, termes: p.comprehension.cherche });
  return {
    question,
    ...g,
    vecteurs: r.vecteurs,
    bandeau: urgence ? reglages.bandeauUrgence[etatReseau ? await etatReseau : 'inconnu'] || reglages.bandeauUrgence.inconnu : null,
    durees: r.durees,
    ...(debug ? {
      debug: {
        comprehension: p.comprehension, requetes: p.requetes, texteVecteur: p.texteVecteur,
        terme: r.terme, meilleurs: r.meilleurs, seuils: reglages.seuils, couverture: reglages.couverture
      }
    } : {})
  };
}

import { readFileSync, statSync } from 'fs';
import { normaliser } from '../lib/normalisation.mjs';

// Understanding without a language model: a hand-written French table (catalogue/synonymes.json)
// turns everyday words into search terms (« j'ai du mal à respirer » → dyspnée, détresse
// respiratoire). An expression of the table is recognised when all its meaningful words are in the
// question, in any order (« le chien m'a mordu » reaches « mordu par un chien »); accents, case,
// plurals and feminines are ignored. Small words (le, de, un…) do not count; negations (pas, plus,
// sans) do. The most precise expressions come first, and one whose words all belong to an
// expression already recognised adds nothing (« morsure » inside « morsure de serpent »).
// The file is read again when it changes.

const FICHIER = process.env.SYNONYMES || '/catalogue/synonymes.json';
// Words that never make an expression: articles, prepositions, pronouns, auxiliaries
const PETITS = new Set(`a ai as au aux avec c ce cet cette d de des du elle en est et il j je l la le les leur lui m ma me mes mon
  n ne on ont ou par pour qu que qui s sa se ses son sur t ta te tes ton tu un une y vous nous`.split(/\s+/).filter(Boolean));

// Normalized, apostrophes and punctuation as spaces, padded: « j'étouffe » → « j etouffe »
export const forme = (s) => ` ${normaliser(String(s)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
const racine = (m) => m.replace(/(es|s|e|x)$/, '');
const mots = (s) => forme(s).trim().split(' ').filter(Boolean);

// Entries of the file, one pattern per expression (its meaningful words), most precise first
export function compiler(table) {
  const motifs = [];
  (table?.entrees || []).forEach((e, rang) => {
    const cherche = (e.cherche || []).filter((t) => typeof t === 'string' && t.trim());
    if (!Array.isArray(e.dit) || !cherche.length) return; // invalid entry: skipped
    for (const d of e.dit) {
      const utiles = [...new Set(mots(d).filter((m) => !PETITS.has(m)).map(racine))];
      if (!utiles.length) continue;
      motifs.push({
        rang,
        mots: utiles,
        longueur: utiles.join(' ').length,
        entree: { theme: e.theme || '', cherche, aussi: (e.aussi || []).filter((t) => typeof t === 'string' && t.trim()) }
      });
    }
  });
  return motifs.sort((a, b) => b.mots.length - a.mots.length || b.longueur - a.longueur);
}

let cache = { cle: null, motifs: [] };
export function motifs(fichier = FICHIER) {
  try {
    const cle = statSync(fichier).mtimeMs;
    if (cache.cle !== cle) {
      cache = { cle, motifs: compiler(JSON.parse(readFileSync(fichier, 'utf8'))) };
    }
  } catch (e) {
    if (cache.cle !== 'erreur') console.error(`Synonymes : ${fichier} illisible (${e.message}), recherche sur la phrase seule`);
    cache = { cle: 'erreur', motifs: [] };
  }
  return cache.motifs;
}

// The entries found in the question, most precise first. terme: first search term of the most
// precise expression (the rules on titles lean on it); cherche and aussi: all terms, without duplicates.
export function comprendre(question, liste = motifs()) {
  const presents = new Set(mots(question).map(racine));
  const trouvees = [];
  const pris = new Set();
  for (const m of liste) {
    if (!m.mots.every((w) => presents.has(w))) continue;
    // Nothing new: all its words already belong to a more precise expression
    if (m.mots.every((w) => pris.has(w))) continue;
    m.mots.forEach((w) => pris.add(w));
    if (!trouvees.some((t) => t.rang === m.rang)) trouvees.push({ ...m.entree, rang: m.rang, dit: m.mots.join(' ') });
  }
  const unique = (l) => [...new Set(l)];
  const cherche = unique(trouvees.flatMap((t) => t.cherche));
  const aussi = unique(trouvees.flatMap((t) => t.aussi)).filter((t) => !cherche.includes(t));
  return {
    question,
    terme: trouvees[0]?.cherche[0] || null,
    cherche,
    aussi,
    themes: unique(trouvees.map((t) => t.theme)),
    entrees: trouvees.map((t) => `${t.dit} → ${t.cherche.join(', ')}`)
  };
}

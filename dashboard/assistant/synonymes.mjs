import { readFileSync, statSync } from 'fs';
import { normaliser } from '../lib/normalisation.mjs';

// Understanding without a language model: a hand-written French table (catalogue/synonymes.json)
// turns everyday words into search terms (« j'ai du mal à respirer » → dyspnée, détresse
// respiratoire). Accents and case are ignored; a word of « dit » also matches its plural and
// feminine forms. Longest expressions first; a matched span is used up, so « mal à la tête » does
// not also trigger an entry on « tête ». The file is read again when it changes.

const FICHIER = process.env.SYNONYMES || '/catalogue/synonymes.json';
const SUFFIXES = '(?:s|e|es|x)?';

// Normalized, apostrophes and punctuation as spaces, padded: « j'étouffe » → « j etouffe »
export const forme = (s) => ` ${normaliser(String(s)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Entries of the file, with one pattern per expression, longest first
export function compiler(table) {
  const motifs = [];
  (table?.entrees || []).forEach((e, rang) => {
    const cherche = (e.cherche || []).filter((t) => typeof t === 'string' && t.trim());
    if (!Array.isArray(e.dit) || !cherche.length) return; // invalid entry: skipped
    for (const d of e.dit) {
      const mots = forme(d).trim().split(' ').filter(Boolean);
      if (!mots.length) continue;
      motifs.push({
        rang,
        longueur: mots.join(' ').length,
        regle: new RegExp(` ${mots.map((m) => echapper(m) + SUFFIXES).join(' ')} `),
        entree: { theme: e.theme || '', cherche, aussi: (e.aussi || []).filter((t) => typeof t === 'string' && t.trim()) }
      });
    }
  });
  return motifs.sort((a, b) => b.longueur - a.longueur);
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

// The entries found in the question, in the order of the table. terme: first search term of the
// longest match (the rules on titles lean on it); cherche and aussi: all terms, without duplicates.
export function comprendre(question, liste = motifs()) {
  let q = forme(question);
  const trouvees = [];
  for (const m of liste) {
    // Spaces are kept on both sides so the next match still finds its word boundaries
    const r = q.match(m.regle);
    if (!r) continue;
    q = q.replace(m.regle, ` ${' '.repeat(r[0].length - 2)} `);
    if (!trouvees.some((t) => t.rang === m.rang)) trouvees.push({ ...m.entree, rang: m.rang, dit: r[0].trim() });
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

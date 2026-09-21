// Accent- and case-insensitive text matching, shared by the book index (server) and the
// highlighting of the opened page (browser). No dependency: plain string work.

const LIGATURES = { 'œ': 'oe', 'Œ': 'oe', 'æ': 'ae', 'Æ': 'ae', 'ß': 'ss' };
const APOSTROPHES = /[’‘`´ʼ]/;
// Too common to be required in every result, and not worth highlighting
const VIDES = new Set(['de', 'la', 'le', 'les', 'du', 'des', 'un', 'une', 'et', 'en', 'au', 'aux', 'a', 'ou', 'sur', 'par', 'pour', 'dans']);
const LETTRE = /[\p{L}\p{N}]/u;

function caractere(c) {
  const code = c.charCodeAt(0);
  if (code < 128) return code >= 65 && code <= 90 ? c.toLowerCase() : c;
  if (LIGATURES[c]) return LIGATURES[c];
  if (APOSTROPHES.test(c)) return "'";
  if (/\s/.test(c)) return ' ';
  return c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Whole text at once, for the index
export function normaliser(s) {
  // Code unit by code unit, like normaliserAvecCarte: both give the same text
  let n = '';
  for (let i = 0; i < s.length; i++) n += caractere(s[i]);
  return n;
}

// Same, with carte[i] = position in s of the i-th normalized character (for excerpts and highlights)
export function normaliserAvecCarte(s) {
  let n = '';
  const carte = [];
  for (let i = 0; i < s.length; i++) {
    const d = caractere(s[i]);
    for (let k = 0; k < d.length; k++) carte.push(i);
    n += d;
  }
  carte.push(s.length);
  return { n, carte };
}

// Words of a query: normalized, 2 letters at least, common words dropped unless nothing else is left
export function motsRequete(q) {
  const tous = [...new Set(normaliser(String(q ?? '').slice(0, 200)).split(/[^\p{L}\p{N}]+/u).filter((m) => m.length >= 2))];
  const utiles = tous.filter((m) => !VIDES.has(m));
  return (utiles.length ? utiles : tous).slice(0, 8);
}

// The whole query as a phrase, common words included (« morsure de serpent »), or null
export function phraseRequete(q) {
  const p = normaliser(String(q ?? '').slice(0, 200)).replace(/[^\p{L}\p{N}']+/gu, ' ').trim();
  return p.includes(' ') ? p : null;
}

// Positions where a word starts (prefix match: « enfant » also finds « enfants »)
export function positions(n, mot, max = Infinity) {
  const res = [];
  for (let i = n.indexOf(mot); i !== -1 && res.length < max; i = n.indexOf(mot, i + 1)) {
    if (i === 0 || !LETTRE.test(n[i - 1])) res.push(i);
  }
  return res;
}

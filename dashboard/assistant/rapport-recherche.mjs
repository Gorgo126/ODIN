import { DatabaseSync } from 'node:sqlite';
import { rmSync, mkdirSync } from 'fs';
import os from 'os';
import { Index } from './index.mjs';
import { chercher } from './recherche-avancee.mjs';
import { DEFAUTS, valider } from './reglages.mjs';

// Report of the advanced search on a series of questions, as the search page answers them (synonym
// table, vectors, three sources), inside the dashboard container, on a COPY of the index:
//   docker exec -i dashboard node assistant/rapport-recherche.mjs < questions.txt
// Input: plain text, one question per line (lines starting with # are skipped), or the JSON of
// tests/recherche.json ({ questions: [{ q, attendu: [...] } | { q, aucun: true }] }).
// Per question: main term and its origin, what the table understood, the first three documents.
// With « attendu »: bon (first), acceptable (2nd or 3rd), mauvais. Without it: « à juger ».
// sans_contenu: nothing suitable in the installed packs, kept out of the score.

const e = process.env;
let brut = '';
for await (const b of process.stdin) brut += b;
let questions;
try {
  questions = JSON.parse(brut).questions;
} catch {
  questions = brut.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((q) => ({ q }));
}

const COPIE = '/tmp/rapport-recherche';
rmSync(COPIE, { recursive: true, force: true });
mkdirSync(COPIE, { recursive: true });
new DatabaseSync('/assistant/index.db', { readOnly: true }).exec(`VACUUM INTO '${COPIE}/index.db'`);
const index = new Index({
  base: `${COPIE}/index.db`, racine: '/documents', ollama: null, urlVecteurs: e.VECTEURS_URL || null,
  modeleEmbedding: e.MODELE_EMBEDDING || 'embeddinggemma:300m', dimensions: 0, inactivite: 120000,
  threads: os.availableParallelism(), lot: 8, extraits: 4, candidats: 20, cible: 400, chevauchement: 55,
  articlesWiki: 15, poidsMots: 0.5
});
const reglages = valider({ ...DEFAUTS });
const rechercher = (q, o) => index.rechercher(q, o);

const forme = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function accepte(g, attendus) {
  return attendus.some((a) => {
    const livre = a.match(/^livre:(\d+)-(\d+)$/);
    if (livre) return g.origine === 'livre' && g.passages.some((p) => p.page >= +livre[1] && p.page <= +livre[2]);
    if (a.startsWith('doc:')) return g.origine === 'documents' && forme(g.titre).startsWith(forme(a.slice(4)));
    return g.origine === 'wiki' && forme(g.titre) === forme(a);
  });
}
const nomGroupe = (g) => {
  const p = g.passages[0];
  const ou = g.origine === 'livre' ? `p. ${p.page}` : p.section && forme(p.section) !== forme(g.titre) ? p.section : '';
  return `${g.etiquette} · ${g.titre}${ou ? ` (${ou})` : ''}`;
};

await chercher({ question: 'eau', rechercher, reglages }).catch(() => {}); // loads the model
const comptes = { bon: 0, acceptable: 0, mauvais: 0, 'à juger': 0, 'sans contenu': 0 };
let n = 0;
for (const q of questions) {
  n++;
  const r = await chercher({ question: q.q, rechercher, reglages, debug: true });
  const groupes = [...r.forts, ...r.proches];
  let verdict = 'à juger';
  if (q.sans_contenu) verdict = 'sans contenu';
  else if (q.aucun) verdict = r.forts.length ? 'mauvais' : 'bon';
  else if (q.attendu?.length) {
    const rang = groupes.findIndex((g) => accepte(g, q.attendu)) + 1;
    verdict = rang === 1 ? 'bon' : rang >= 2 && rang <= 3 ? 'acceptable' : 'mauvais';
  }
  comptes[verdict]++;
  const t = r.debug.terme || {};
  console.log(`\n${n}. ${q.q}`);
  console.log(`   terme : ${t.terme || 'aucun'} (${t.source || '–'}) · table : ${r.debug.comprehension.entrees.join(' ; ') || 'rien'}`);
  console.log(`   en tête : ${groupes[0] ? `${nomGroupe(groupes[0])}${r.forts.length ? '' : ' [proche seulement]'}` : 'rien au-dessus des seuils'}`);
  if (groupes.length > 1) console.log(`   ensuite : ${groupes.slice(1, 3).map(nomGroupe).join(' | ')}`);
  console.log(`   bandeau d'urgence : ${r.bandeau ? 'oui' : 'non'}`);
  console.log(`   verdict : ${verdict}`);
}
console.log(`\nBilan sur ${n} questions : ${Object.entries(comptes).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')}`);
index.db.close();
process.exit(0);

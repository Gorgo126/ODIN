import { DatabaseSync } from 'node:sqlite';
import { rmSync, mkdirSync } from 'fs';
import os from 'os';
import { Index } from './index.mjs';
import { chercher } from './recherche-avancee.mjs';
import { DEFAUTS, valider } from './reglages.mjs';
import { vectoriser, reduire, profil } from './embeddings.mjs';

// Measure of the advanced search on the real packs, books and documents, inside the dashboard
// container, on a COPY of the index (never data/):
//   docker exec -i [-e LLAMA_URL=http://llama:8080] dashboard node assistant/evaluation-recherche.mjs < tests/recherche.json
// Configurations: « brute » (raw phrase, hybrid Ollama: the reference of lot 1), « bm25 » (synonyms,
// keywords only), « ollama » (synonyms, hybrid, vectors by Ollama), « llama » (synonyms, hybrid,
// vectors by a llama.cpp server, when LLAMA_URL is set). CONFIGS=bm25,ollama picks some.
// Per question: rank of the first accepted document among the groups shown (strong ones, then
// close ones). Off-topic questions (aucun) must give no strong group.

const e = process.env;
const lire = async () => { let s = ''; for await (const b of process.stdin) s += b; return JSON.parse(s); };
const { questions } = await lire();

const COPIE = '/tmp/eval-recherche';
rmSync(COPIE, { recursive: true, force: true });
mkdirSync(COPIE, { recursive: true });
// A consistent snapshot of the live index (WAL included), read-only on the source
new DatabaseSync('/assistant/index.db', { readOnly: true }).exec(`VACUUM INTO '${COPIE}/index.db'`);

const base = {
  base: `${COPIE}/index.db`, racine: '/documents',
  ollama: e.OLLAMA_URL || 'http://ollama:11434',
  modeleEmbedding: e.MODELE_EMBEDDING || 'embeddinggemma:300m',
  dimensions: 0, keepAlive: '30m', inactivite: 120000,
  threads: Number(e.ASSISTANT_THREADS) || os.availableParallelism(),
  lot: 8, extraits: 4, candidats: 20, cible: 400, chevauchement: 55, articlesWiki: 15, poidsMots: 0.5
};
const CONFIGS = {
  brute: { synonymes: false, cfg: {} },
  bm25: { synonymes: true, cfg: { sansVecteurs: true } },
  ollama: { synonymes: true, cfg: {} },
  ...(e.LLAMA_URL ? { llama: { synonymes: true, cfg: { urlVecteurs: e.LLAMA_URL } } } : {})
};
const choisies = (e.CONFIGS ? e.CONFIGS.split(',') : Object.keys(CONFIGS)).filter((c) => CONFIGS[c]);
const reglages = valider({ ...DEFAUTS });

const forme = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function accepte(g, attendus) {
  return attendus.some((a) => {
    const livre = a.match(/^livre:(\d+)-(\d+)$/);
    if (livre) return g.origine === 'livre' && g.passages.some((p) => p.page >= +livre[1] && p.page <= +livre[2]);
    if (a.startsWith('doc:')) return g.origine === 'documents' && forme(g.titre).startsWith(forme(a.slice(4)));
    return g.origine === 'wiki' && forme(g.titre) === forme(a);
  });
}

// Same text, both engines: how close are the vectors? (cosine between the two, after the same cut)
async function comparerMoteurs() {
  const prof = profil(base.modeleEmbedding);
  const textes = [
    ...questions.slice(0, 10).map((q) => prof.requete(q.q)),
    ...['La brûlure du premier degré touche seulement l\'épiderme ; refroidir sous l\'eau tiède pendant vingt minutes.',
      'Faire bouillir l\'eau pendant au moins une minute la rend potable.',
      'L\'hypothermie survient quand la température du corps descend sous 35 °C.'].map((t) => prof.document(t, 'none'))
  ];
  const t1 = Date.now();
  const a = await vectoriser(base, textes);
  const dA = Date.now() - t1;
  const t2 = Date.now();
  const b = await vectoriser({ ...base, urlVecteurs: e.LLAMA_URL }, textes);
  const dB = Date.now() - t2;
  const cos = a.map((v, i) => {
    const x = reduire(v, v.length), y = reduire(b[i], v.length);
    let s = 0; for (let k = 0; k < x.length; k++) s += x[k] * y[k];
    return s;
  });
  console.log(`Vecteurs Ollama / llama.cpp, ${textes.length} textes : dimensions ${a[0].length} / ${b[0].length}, cosinus entre les deux min ${Math.min(...cos).toFixed(4)}, moyenne ${(cos.reduce((s, c) => s + c, 0) / cos.length).toFixed(4)} ; temps ${dA} ms / ${dB} ms\n`);
}
if (e.LLAMA_URL) await comparerMoteurs();

const bilan = {};
const rangs = {};
for (const nom of choisies) {
  const { synonymes, cfg } = CONFIGS[nom];
  const index = new Index({ ...base, ...cfg });
  const rechercher = (q, o) => index.rechercher(q, o);
  // Warm-up: the first call loads the model
  await chercher({ question: 'eau', rechercher, reglages, synonymes }).catch(() => {});
  const res = [];
  for (const q of questions) {
    const t = Date.now();
    let r;
    try {
      r = await chercher({ question: q.q, rechercher, reglages, synonymes });
    } catch (err) {
      res.push({ q, erreur: err.message, duree: Date.now() - t });
      continue;
    }
    const groupes = [...r.forts, ...r.proches];
    const rang = q.aucun ? null : groupes.findIndex((g) => accepte(g, q.attendu)) + 1 || null;
    res.push({ q, r, rang, duree: Date.now() - t, forts: r.forts.length, premier: groupes[0] ? `${groupes[0].etiquette} ${groupes[0].titre}` : '–' });
  }
  const avec = res.filter((x) => !x.q.aucun);
  const sans = res.filter((x) => x.q.aucun);
  bilan[nom] = {
    top1: avec.filter((x) => x.rang === 1).length,
    top3: avec.filter((x) => x.rang && x.rang <= 3).length,
    trouve: avec.filter((x) => x.rang).length,
    mrr: avec.reduce((s, x) => s + (x.rang ? 1 / x.rang : 0), 0) / avec.length,
    aucun: sans.filter((x) => x.forts === 0).length,
    n: avec.length, nAucun: sans.length,
    duree: Math.round(res.reduce((s, x) => s + x.duree, 0) / res.length),
    vecteurs: res.every((x) => x.r?.vecteurs)
  };
  rangs[nom] = res;
  index.db.close();
}

console.log('Question'.padEnd(52) + choisies.map((c) => c.padStart(8)).join(''));
questions.forEach((q, i) => {
  const cases = choisies.map((c) => {
    const x = rangs[c][i];
    if (x.erreur) return 'err';
    if (q.aucun) return x.forts ? `${x.forts} fort` : 'ok';
    return x.rang ? `#${x.rang}` : '—';
  });
  console.log(q.q.slice(0, 50).padEnd(52) + cases.map((s) => s.padStart(8)).join(''));
});
console.log('\nPremier résultat quand la bonne source manque :');
questions.forEach((q, i) => choisies.forEach((c) => {
  const x = rangs[c][i];
  if (!q.aucun && !x.rang && !x.erreur) console.log(`  [${c}] ${q.q} → ${x.premier}`);
  if (q.aucun && x.forts) console.log(`  [${c}] ${q.q} (hors sujet) → ${x.premier}`);
  if (x.erreur) console.log(`  [${c}] ${q.q} : erreur ${x.erreur}`);
}));
console.log('\nBilan');
for (const c of choisies) {
  const b = bilan[c];
  console.log(`  ${c.padEnd(7)} en tête ${b.top1}/${b.n}, dans les 3 premiers ${b.top3}/${b.n}, trouvée ${b.trouve}/${b.n}, MRR ${b.mrr.toFixed(2)}, hors sujet sans « meilleurs » ${b.aucun}/${b.nAucun}, ${b.duree} ms par question${b.vecteurs ? '' : ' (sans vecteurs)'}`);
}

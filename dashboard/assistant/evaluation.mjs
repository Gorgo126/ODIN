import { promises as fs } from 'fs';
import { Index } from './index.mjs';
import { repondre } from './reponse.mjs';
import { DEFAUTS, valider } from './reglages.mjs';
import { normaliser } from '../lib/normalisation.mjs';

// Evaluation of the assistant on tests/documents and tests/questions.json, inside the dashboard
// container, against the real Ollama, on a separate index in /tmp (never data/):
//   tar c -C tests documents questions.json | docker exec -i -e MODELE_CHAT=qwen3:1.7b dashboard \
//     sh -c 'rm -rf /tmp/eval && mkdir -p /tmp/eval && tar x -C /tmp/eval && node assistant/evaluation.mjs /tmp/eval'
// Checks, per question: expected outcome, expected words (outcome 1), forbidden words (invented
// answer; answer given in outcome 2), share of the answer copied word for word from the chunks
// (outcome 1, exact values excluded: over 40 % fails). Prints the best cosines for the thresholds.

const DOSSIER = process.argv[2] || '/tmp/eval';
const e = process.env;
const cfg = {
  base: `${DOSSIER}/index.db`, racine: `${DOSSIER}/documents`,
  ollama: e.OLLAMA_URL || 'http://ollama:11434',
  modeleEmbedding: e.MODELE_EMBEDDING || 'embeddinggemma:300m',
  modeleChat: e.MODELE_CHAT || DEFAUTS.modeleChat,
  dimensions: 0, keepAlive: '30m', inactivite: 300000,
  threads: Number(e.ASSISTANT_THREADS) || (await import('os')).availableParallelism(),
  numCtx: 4096, lot: 8, extraits: 4, candidats: 20, cible: 400, chevauchement: 55,
  poidsMots: Number(e.ASSISTANT_POIDS_MOTS) || 1
};
const reglages = valider({
  ...DEFAUTS, modeleChat: cfg.modeleChat, debug: true,
  ...(e.SEUIL_REPONSE ? { seuilReponse: Number(e.SEUIL_REPONSE) } : {}),
  ...(e.SEUIL_PROCHES ? { seuilProches: Number(e.SEUIL_PROCHES) } : {})
});
const { questions } = JSON.parse(await fs.readFile(`${DOSSIER}/questions.json`, 'utf8'));

// Share of the answer's 5-word sequences found in the chunks; words with a digit (amounts, dates,
// references) are dropped first: copying an exact value is allowed
function partCopiee(reponse, extraits) {
  const mots = (s) => normaliser(s.replace(/\[\d+\]/g, ' ')).split(/[^\p{L}\p{N}]+/u).filter((m) => m && !/\d/.test(m));
  const source = ' ' + extraits.map((x) => mots(x.texte).join(' ')).join(' | ') + ' ';
  const m = mots(reponse);
  if (m.length < 5) return 0;
  let copies = 0;
  for (let i = 0; i + 5 <= m.length; i++) if (source.includes(' ' + m.slice(i, i + 5).join(' ') + ' ')) copies++;
  return copies / (m.length - 4);
}

const index = new Index(cfg);
let t = Date.now();
await index.scanner();
const etat = index.etat();
console.log(`Index : ${etat.documents} documents, ${etat.morceaux} morceaux en ${((Date.now() - t) / 1000).toFixed(0)} s (résumés compris), problèmes : ${etat.problemes.map((p) => `${p.chemin} (${p.statut})`).join(', ') || 'aucun'}`);
for (const f of index.db.prepare('SELECT chemin, resume, resume_modele FROM fichiers WHERE statut = \'indexe\' ORDER BY chemin').all()) {
  console.log(`  résumé${f.resume_modele ? '' : ' provisoire'} ${f.chemin} : ${f.resume}`);
}
console.log(`\nModèle ${cfg.modeleChat}, seuils ${reglages.seuilReponse} / ${reglages.seuilProches}, poids des mots-clés ${cfg.poidsMots}\n`);

const resultats = [];
for (const q of questions) {
  let texte = '', fin = null, erreur = null;
  t = Date.now();
  for await (const ev of repondre({
    question: q.question, reglages, cfg,
    rechercher: (question, o) => index.rechercher(question, o),
    reprendre: (jeton) => index.reprendre(jeton)
  })) {
    if (ev.type === 'texte') texte += ev.texte;
    else if (ev.type === 'fin') fin = ev;
    else if (ev.type === 'erreur') erreur = ev.message;
  }
  const bas = texte.toLowerCase();
  const echecs = [];
  if (erreur) echecs.push(`erreur : ${erreur}`);
  if (fin && fin.issue !== q.issue) echecs.push(`issue ${fin.issue} au lieu de ${q.issue}`);
  if (fin?.issue === 1 && q.attendu && !q.attendu.some((a) => bas.includes(a.toLowerCase()))) echecs.push(`aucun de ${JSON.stringify(q.attendu)}`);
  const interdits = (q.interdit || []).filter((a) => bas.includes(a.toLowerCase()));
  if (interdits.length) echecs.push(`interdit : ${JSON.stringify(interdits)}`);
  const copie = fin?.issue === 1 ? partCopiee(texte, fin.debug.extraits.filter((x) => x.envoye)) : 0;
  if (copie > 0.4) echecs.push(`copie ${Math.round(copie * 100)} %`);
  resultats.push({ q, fin, echecs, copie });
  console.log(`${echecs.length ? 'KO' : 'OK'} [attendu ${q.issue}, obtenu ${fin?.issue ?? '?'}] cos ${fin?.meilleurCosinus?.toFixed(3)} | 1er mot ${fin?.durees.premierMot ?? '–'} ms, total ${fin?.durees.total ?? '–'} ms | copie ${Math.round(copie * 100)} %`);
  console.log(`   Q : ${q.question}`);
  console.log(`   R : ${texte.replace(/\s+/g, ' ').trim()}`);
  if (fin?.sources?.length) console.log(`   Sources : ${fin.sources.map((s) => s.titre + (s.pages.length ? ` p. ${s.pages}` : '')).join(' · ')}`);
  if (fin?.documents?.length) console.log(`   Documents : ${fin.documents.map((d) => d.titre).join(' · ')}`);
  if (fin?.issue === 1) console.log(`   Extraits envoyés : ${fin.debug.extraits.filter((x) => x.envoye).length}/${fin.debug.extraits.length}`);
  if (echecs.length) console.log(`   ⚠ ${echecs.join(' ; ')}`);
}

const ok = resultats.filter((r) => !r.echecs.length).length;
const cos = (issue) => resultats.filter((r) => r.q.issue === issue).map((r) => r.fin?.meilleurCosinus ?? 0).sort((a, b) => a - b);
const moyenne = (l) => Math.round(l.reduce((s, x) => s + x, 0) / (l.length || 1));
const avecMot = resultats.filter((r) => r.fin && r.fin.issue !== 3);
console.log(`\nBilan : ${ok}/${resultats.length} questions sans échec`);
for (const i of [1, 2, 3]) console.log(`  cosinus max, questions d'issue ${i} : ${cos(i).map((c) => c.toFixed(3)).join(' ')}`);
console.log(`  temps moyen jusqu'au 1er mot (issues 1 et 2) : ${moyenne(avecMot.map((r) => r.fin.durees.premierMot))} ms, total : ${moyenne(avecMot.map((r) => r.fin.durees.total))} ms`);
console.log(`  part copiée moyenne (issue 1) : ${Math.round(100 * resultats.filter((r) => r.fin?.issue === 1).reduce((s, r) => s + r.copie, 0) / (resultats.filter((r) => r.fin?.issue === 1).length || 1))} %`);
process.exit(ok === resultats.length ? 0 : 1);

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { Index } from './index.mjs';
import { profil, reduire, vectoriser } from './embeddings.mjs';

// Embedding model bench, run inside the dashboard container against the real Ollama:
//   docker exec -i dashboard node assistant/banc.mjs < tests/banc-embeddings.json
// For each entry: indexing time of the corpus (CPU) with its batch size and threads, delay of a
// question asked during that indexing, memory of the loaded model (Ollama /api/ps), then for each
// dimension count and keyword weight, the rank of the first relevant chunk for each question.
// Works on copies in /tmp/banc, never on data/.

let entree = '';
for await (const c of process.stdin) entree += c;
const { corpus, modeles, questions } = JSON.parse(entree);
const ollama = process.env.OLLAMA_URL || 'http://ollama:11434';
const DOSSIER = '/tmp/banc';

await fs.rm(DOSSIER, { recursive: true, force: true });
await fs.mkdir(`${DOSSIER}/corpus`, { recursive: true });
for (const f of corpus) await fs.copyFile(f, `${DOSSIER}/corpus/${path.basename(f)}`);

const mo = (n) => `${Math.round(n / 1048576)} Mo`;
for (const m of modeles) {
  const lot = m.lot || 8;
  const threads = m.threads ?? os.availableParallelism();
  const cfg = {
    base: `${DOSSIER}/${m.modele.replace(/\W+/g, '_')}-${lot}-${threads}.db`, racine: `${DOSSIER}/corpus`, ollama,
    modeleEmbedding: m.modele, dimensions: 0, keepAlive: '10m', inactivite: 300000,
    lot, threads, extraits: 4, candidats: 20, cible: 400, chevauchement: 55
  };
  const idx = new Index(cfg);
  const debut = Date.now();
  const scan = idx.scanner();
  // Questions during the indexing: they must not wait behind it
  const attentes = [];
  for (const delai of [60000, 30000, 30000]) {
    await new Promise((r) => setTimeout(r, delai));
    if (!idx.enCours) break;
    const t = Date.now();
    await idx.rechercher(questions[attentes.length % questions.length].question);
    attentes.push(Date.now() - t);
  }
  await scan;
  const duree = (Date.now() - debut) / 1000;
  const e = idx.etat();
  const ps = await (await fetch(`${ollama}/api/ps`, { signal: AbortSignal.timeout(5000) })).json();
  const charge = ps.models.find((x) => x.name === m.modele || x.model === m.modele);
  console.log(`\n## ${m.modele}, lots de ${lot}, ${threads || 'défaut'} threads : ${e.morceaux} morceaux en ${duree.toFixed(0)} s (${(e.morceaux / duree).toFixed(2)} morceaux/s), modèle chargé ${charge ? mo(charge.size) : '?'}`);
  console.log(`   questions pendant l'indexation : ${attentes.map((a) => `${a} ms`).join(', ') || 'aucune (indexation trop courte)'}`);
  if (e.problemes.length) console.log(`   problèmes : ${JSON.stringify(e.problemes)}`);

  const ligne = idx.db.prepare('SELECT chemin, page FROM morceaux WHERE id = ?');
  for (const d of m.dimensions) for (const poids of m.poids || [1]) {
    idx.cfg.dimensions = d;
    idx.cfg.poidsMots = poids;
    idx.charger();
    const rangs = [];
    let temps = 0;
    for (const q of questions) {
      const pertinent = (x) => x && x.chemin === q.fichier && q.pages.includes(x.page);
      const r = await idx.rechercher(q.question);
      temps += r.duree;
      const hybride = r.extraits.findIndex(pertinent) + 1;
      const [v] = await vectoriser(cfg, [profil(m.modele).requete(q.question)]);
      const proches = idx.plusProches(reduire(v, idx.memoire.d), 20);
      const vecteur = proches.findIndex((p) => pertinent(ligne.get(p.id))) + 1;
      rangs.push({ hybride, vecteur, cos: r.meilleurCosinus });
      console.log(`   ${String(d || idx.memoire.d).padStart(4)} d, mots ×${poids} | hybride top 4 : ${hybride || '–'} | vecteurs seuls top 20 : ${vecteur || '–'} | cos max ${r.meilleurCosinus?.toFixed(3)} | ${q.question}`);
    }
    const trouves = rangs.filter((r) => r.hybride).length;
    const premiers = rangs.filter((r) => r.hybride === 1).length;
    const mrr = rangs.reduce((s, r) => s + (r.vecteur ? 1 / r.vecteur : 0), 0) / rangs.length;
    console.log(`   => ${idx.memoire.d} dimensions, mots-clés ×${poids} : hybride ${trouves}/${questions.length} dans les 4 extraits (${premiers} en tête), MRR vecteurs seuls ${mrr.toFixed(2)}, vecteurs en mémoire ${mo(idx.memoire.matrice.byteLength)} (${(idx.memoire.d * 4 * 10000 / 1048576).toFixed(0)} Mo pour 10 000 morceaux), ${Math.round(temps / questions.length)} ms par recherche`);
  }
}
await fs.rm(DOSSIER, { recursive: true, force: true });

import { parentPort, workerData } from 'worker_threads';
import { watch, mkdirSync } from 'fs';
import path from 'path';
import { Index } from './index.mjs';

// Worker thread of the document assistant: indexing and similarity search run here, so they never
// block the event loop of the Next.js server. Requests come as { id, type, args } messages.

const cfg = workerData;
const log = (...a) => console.log('[assistant]', ...a);
const PERIODE = 5 * 60 * 1000; // periodic scan: catches missed events and retries files waiting for Ollama

mkdirSync(path.dirname(cfg.base), { recursive: true });
const index = new Index(cfg);

let minuterie = null;
function planifier(delai = 3000) {
  clearTimeout(minuterie);
  minuterie = setTimeout(() => index.scanner().catch((e) => log(`Indexation interrompue : ${e.message}`)), delai);
}

planifier(5000);
setInterval(() => planifier(0), PERIODE);
// FileBrowser writes into the same host folder: its changes arrive here through inotify.
// Events come in bursts (upload, copy of a folder), hence the 3 s delay.
try {
  watch(cfg.racine, { recursive: true }, () => planifier());
} catch (e) {
  log(`Surveillance de ${cfg.racine} impossible (${e.message}) : scan toutes les 5 min seulement`);
}

parentPort.on('message', async ({ id, type, args = {} }) => {
  try {
    let resultat;
    if (type === 'etat') resultat = index.etat();
    else if (type === 'rechercher') resultat = await index.rechercher(String(args.question), args);
    else if (type === 'reprendre') resultat = index.reprendre(args.jeton);
    else if (type === 'reindexer') {
      index.scanner({ complet: args.complet === true }).catch((e) => log(`Indexation interrompue : ${e.message}`));
      resultat = index.etat();
    } else throw new Error(`demande inconnue : ${type}`);
    parentPort.postMessage({ id, ok: true, resultat });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, erreur: e.message });
  }
});

log(`Démarré : ${cfg.racine}, modèle ${cfg.modeleEmbedding}${cfg.dimensions ? `, ${cfg.dimensions} dimensions` : ''}`);

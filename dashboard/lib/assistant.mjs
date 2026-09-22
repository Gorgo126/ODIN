import { Worker } from 'worker_threads';
import path from 'path';

// Document assistant: indexing and search live in a worker thread (assistant/worker.mjs, copied as
// plain files into the image, outside the Next bundle). This module starts it and relays requests.

function config() {
  const e = process.env;
  return {
    base: '/assistant/index.db',
    racine: '/documents',
    ollama: e.OLLAMA_URL || 'http://ollama:11434',
    modeleEmbedding: e.MODELE_EMBEDDING || 'embeddinggemma:300m',
    // 0 = all the dimensions of the model; EmbeddingGemma can be cut (Matryoshka)
    dimensions: Number(e.ASSISTANT_DIMENSIONS) || 0,
    keepAlive: e.OLLAMA_KEEP_ALIVE || '30m',
    // Inactivity delay of Ollama calls: long enough to load a model on CPU
    inactivite: 120000,
    extraits: 4,
    candidats: 20,
    cible: 400,
    chevauchement: 55
  };
}

// Shared through globalThis: instrumentation and route handlers are separate bundles
const etat = globalThis.__odinAssistant ??= { worker: null, attente: new Map(), suivant: 0 };

function lancer() {
  // Built at run time: webpack must not try to bundle the worker
  const w = new Worker(path.join(process.cwd(), 'assistant', 'worker.mjs'), { workerData: config() });
  w.on('message', ({ id, ok, resultat, erreur }) => {
    const a = etat.attente.get(id);
    if (!a) return;
    etat.attente.delete(id);
    clearTimeout(a.minuterie);
    if (ok) a.resolve(resultat);
    else a.reject(new Error(erreur));
  });
  w.on('error', (e) => console.error(`Assistant : ${e.stack || e.message}`));
  w.on('exit', (code) => {
    etat.worker = null;
    for (const a of etat.attente.values()) { clearTimeout(a.minuterie); a.reject(new Error('Assistant arrêté')); }
    etat.attente.clear();
    // Restarted after a crash, never in a tight loop
    console.error(`Assistant arrêté (code ${code}), redémarrage dans 10 s`);
    setTimeout(demarrerAssistant, 10000);
  });
  etat.worker = w;
}

export function demarrerAssistant() {
  if (!etat.worker) lancer();
}

// The search may wait for the embedding model to load on CPU: generous delay
export function demander(type, args = {}, delai = 180000) {
  demarrerAssistant();
  return new Promise((resolve, reject) => {
    const id = ++etat.suivant;
    const minuterie = setTimeout(() => {
      etat.attente.delete(id);
      reject(new Error('L\'assistant ne répond pas'));
    }, delai);
    etat.attente.set(id, { resolve, reject, minuterie });
    etat.worker.postMessage({ id, type, args });
  });
}

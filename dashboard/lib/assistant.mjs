import { Worker } from 'worker_threads';
import path from 'path';
import os from 'os';
import { readFileSync } from 'fs';
import { promises as fsp } from 'fs';
import { DEFAUTS, valider } from '../assistant/reglages.mjs';
import { liaison } from './liaison.mjs';
import { ecrireJson } from './fichiers.mjs';

const FICHIER_REGLAGES = '/config/assistant.json';

// Settings of the assistant (edited from lot 4). The installer picks the language model from the
// memory of the machine (MODELE_CHAT); a model chosen in the settings takes precedence.
export function reglagesAssistant() {
  let lu = {};
  try { lu = JSON.parse(readFileSync(FICHIER_REGLAGES, 'utf8')); } catch {}
  return valider({ ...DEFAUTS, ...lu });
}

// Saves the settings. A model change restarts the worker at once (its configuration is read when
// it starts), and a new embedding model makes it index everything again.
export async function ecrireReglagesAssistant(modifs) {
  const avant = reglagesAssistant();
  const definis = Object.fromEntries(Object.entries(modifs).filter(([, v]) => v !== undefined));
  const valeur = valider({ ...avant, ...definis });
  await fsp.mkdir('/config', { recursive: true });
  await ecrireJson(FICHIER_REGLAGES, valeur, 1);
  // Left over from the days when a picture could be uploaded
  await fsp.rm('/config/avatar', { force: true }).catch(() => {});
  return { reglages: valeur };
}

const threads = () => Number(process.env.ASSISTANT_THREADS) || os.availableParallelism();

// State of the network for the emergency warning: the « Connectivité externe » probe of the home
// page, read as it is (it refreshes by itself every 45 s and answers at once). An answer is never
// delayed by it: without a result in 300 ms, the wording for an unknown state is used.
export async function reseauAssistant() {
  try {
    const l = await Promise.race([liaison(), new Promise((r) => setTimeout(() => r(null), 300))]);
    if (!l || l.silence || l.etat === 'inconnu') return 'inconnu';
    return l.enLigne ? 'disponible' : 'indisponible';
  } catch {
    return 'inconnu';
  }
}

// Options of the language model calls: identical on every call, or Ollama reloads the model.
// Without the AI option (no OLLAMA_URL, see compose.ia.yml) there is no language model at all.
export const iaInstallee = () => !!process.env.OLLAMA_URL;
export function configGeneration(reglages) {
  return {
    ollama: process.env.OLLAMA_URL || null,
    modeleChat: iaInstallee() ? process.env.MODELE_CHAT || reglages.modeleChat : null,
    keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
    // Inactivity delay of Ollama calls: long enough to load a model on CPU
    inactivite: 120000,
    // All the cores (Ollama's own default used only half of them on nomad)
    threads: threads(),
    numCtx: 4096
  };
}

// Document assistant: indexing and search live in a worker thread (assistant/worker.mjs, copied as
// plain files into the image, outside the Next bundle). This module starts it and relays requests.

function config() {
  const e = process.env;
  const reglages = reglagesAssistant();
  return {
    ...configGeneration(reglages),
    base: '/assistant/index.db',
    racine: '/documents',
    modeleEmbedding: process.env.MODELE_EMBEDDING || reglages.modeleEmbedding,
    // Vectors by the llama.cpp server of compose.yml (Ollama only when no such service is set)
    urlVecteurs: process.env.VECTEURS_URL || null,
    // 0 = all the dimensions of the model; EmbeddingGemma can be cut (Matryoshka)
    dimensions: Number(e.ASSISTANT_DIMENSIONS) || 0,
    lot: Number(e.ASSISTANT_LOT) || 8,
    extraits: reglages.extraits,
    // Keywords weigh half as much as the vectors (bench, lot 3); needed for exact terms and codes
    poidsMots: Number(e.ASSISTANT_POIDS_MOTS) || 0.5,
    candidats: 20,
    // Kiwix articles read per question (their paragraphs are sorted locally, 8 get an embedding)
    articlesWiki: 15,
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


// The search may wait for the vector service to start: generous delay
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

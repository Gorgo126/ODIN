import { readFileSync } from 'fs';
import { lireJson, ecrireJson } from './fichiers.mjs';
import { enLigne, HORS_LIAISON } from './liaison.mjs';
import { espaceDisque } from './etat.mjs';
import { octets } from './format.mjs';

// AI option: a language model on a graphics card, installed from the « Assistant IA » page.
// install.sh detects the hardware (data/config/materiel.json) and runs Ollama only when a card can
// take a model (compose.ia.yml + compose.nvidia.yml or compose.amd.yml). This module reads that
// detection, says which models fit, and downloads, checks, tests and removes them through the
// Ollama API. The GPU path is NOT VERIFIED on real hardware: every failure falls back to the
// advanced search, with a message that says what to do.

const MATERIEL = '/config/materiel.json';
const ETAT = '/config/ia.json';
const CATALOGUE = '/catalogue/modeles-ia.json';
const INACTIVITE = 120000;          // download: no data for 2 min → stopped (Ollama reports progress all along)
const MARGE = 1024 ** 3;            // free space kept on top of the model
const DELAI_TEST = 10 * 60 * 1000;  // loading a model: seconds on a GPU, minutes on a CPU (simulation)

const url = () => process.env.OLLAMA_URL || null;
// Shared through globalThis: routes and instrumentation are separate bundles
const etatTache = globalThis.__odinIA ??= { tache: null, controle: null };

const go = (mo) => `${Math.round(mo / 1024)} Go`;

// What stands in the way, from the reason written by install.sh
const RAISONS = {
  inconnu: 'Le matériel n\'a pas encore été détecté : relancez l\'installeur d\'ODIN sur ce serveur (même commande qu\'à l\'installation).',
  aucune: 'Aucune carte graphique NVIDIA ou AMD n\'a été trouvée. ODIN fonctionne en recherche avancée, qui n\'a pas besoin d\'IA.',
  memoire: (vram) => `La carte graphique n'a que ${go(vram)} de mémoire : un modèle utilisable en demande 8 au moins. ODIN fonctionne en recherche avancée, qui n'a pas besoin d'IA.`,
  pilote: 'Une carte NVIDIA est présente, mais son pilote n\'est pas installé. Installez-le (sudo ubuntu-drivers install), redémarrez le serveur, puis relancez l\'installeur d\'ODIN.',
  toolkit: 'La carte NVIDIA fonctionne, mais Docker ne peut pas encore s\'en servir. Installez le NVIDIA Container Toolkit (paquet nvidia-container-toolkit, puis sudo nvidia-ctk runtime configure --runtime=docker et sudo systemctl restart docker), puis relancez l\'installeur d\'ODIN.',
  rocm: 'Une carte AMD est présente, mais ROCm n\'est pas actif (/dev/kfd absent). Installez ROCm (amdgpu-install), redémarrez le serveur, puis relancez l\'installeur d\'ODIN.',
  moteur: 'Le moteur d\'IA (Ollama) ne répond pas. S\'il vient d\'être installé, patientez une minute ; sinon, relancez l\'installeur d\'ODIN.'
};

export async function catalogue() {
  const c = await lireJson(CATALOGUE, { modeles: [] });
  return (c.modeles || []).filter((m) => m?.id && m.tag && m.taille > 0 && m.vram_min_mo >= 0);
}

// Tag of the model in use, for the assistant (synchronous: read when a question arrives)
export function modeleActif() {
  try {
    const e = JSON.parse(readFileSync(ETAT, 'utf8'));
    if (!e.actif) return null;
    return JSON.parse(readFileSync(CATALOGUE, 'utf8')).modeles.find((m) => m.id === e.modele)?.tag || null;
  } catch {
    return null;
  }
}

// Installed models, or joignable: false when Ollama is absent or does not answer
async function sonder() {
  if (!url()) return { joignable: false, installes: [] };
  try {
    const r = await fetch(`${url()}/api/tags`, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    if (!r.ok) return { joignable: false, installes: [] };
    return { joignable: true, installes: ((await r.json()).models || []).map((m) => ({ tag: m.name, digest: m.digest || '' })) };
  } catch {
    return { joignable: false, installes: [] };
  }
}

export async function etat() {
  const [materiel, choix, modeles, disque, moteur] = await Promise.all([
    lireJson(MATERIEL, null), lireJson(ETAT, {}), catalogue(), espaceDisque(), sonder()
  ]);
  const vram = Math.max(0, ...(materiel?.cartes || []).map((c) => c.vram_mo || 0));
  let raison = null;
  if (!materiel) raison = RAISONS.inconnu;
  else if (!materiel.option) raison = materiel.raison === 'memoire' ? RAISONS.memoire(vram) : RAISONS[materiel.raison] || RAISONS.aucune;
  else if (!moteur.joignable) raison = RAISONS.moteur;
  const possible = !raison;
  return {
    materiel,
    vram,
    possible,
    raison,
    // Case shown at the top of the page: the largest model the card can take
    cas: !possible ? 'impossible' : vram >= 15360 ? '16' : '8',
    moteur: { joignable: moteur.joignable },
    modeles: modeles.filter((m) => !m.simulation || materiel?.simule).map((m) => {
      const installe = moteur.installes.find((i) => i.tag === m.tag);
      let bloque = null;
      if (!possible) bloque = materiel?.option ? 'Moteur d\'IA injoignable' : 'Pas de carte graphique adaptée';
      else if (vram < m.vram_min_mo) bloque = `Demande ${go(m.vram_min_mo)} de mémoire graphique (${go(vram)} détectés)`;
      return {
        ...m,
        installe: !!installe,
        // Pulled by tag: a tag moved upstream gives another model than the one checked for ODIN
        empreinteOk: installe ? installe.digest.replace(/^sha256:/, '').startsWith(m.empreinte) : null,
        bloque,
        actif: choix.modele === m.id && choix.actif === true
      };
    }),
    choix,
    disque,
    tache: etatTache.tache
  };
}

// Readable message for a failed download
function message(err, raison) {
  if (raison === 'annule') return null;
  if (raison === 'inactif') return 'Connexion perdue : aucune donnée depuis 2 minutes. « Réessayer » reprend là où le téléchargement s\'est arrêté.';
  if (err.message === 'fetch failed') return RAISONS.moteur;
  if (/registry|dial tcp|lookup|timeout|no such host|connection refused/i.test(err.message)) {
    return 'Registre des modèles injoignable : internet est-il disponible ? « Réessayer » reprend là où le téléchargement s\'est arrêté.';
  }
  return err.message;
}

// Download through Ollama (/api/pull, NDJSON progress). Partial layers stay in Ollama: a new try
// resumes them. Progress: bytes received over every layer.
async function telecharger(m, t, controle) {
  let minuterie;
  const rearmer = () => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => controle.abort('inactif'), INACTIVITE);
  };
  rearmer();
  try {
    const r = await fetch(`${url()}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: m.tag, stream: true }),
      signal: controle.signal
    });
    if (!r.ok) throw new Error(`Ollama : ${(await r.text().catch(() => '')).slice(0, 200) || r.status}`);
    const couches = new Map();
    const decodeur = new TextDecoder();
    let reste = '';
    for await (const bloc of r.body) {
      rearmer();
      reste += decodeur.decode(bloc, { stream: true });
      let i;
      while ((i = reste.indexOf('\n')) !== -1) {
        const ligne = reste.slice(0, i).trim();
        reste = reste.slice(i + 1);
        if (!ligne) continue;
        const o = JSON.parse(ligne);
        if (o.error) throw new Error(o.error);
        t.statut = o.status || t.statut;
        if (o.digest && o.total) couches.set(o.digest, { total: o.total, recu: o.completed || 0 });
        const l = [...couches.values()];
        t.recu = l.reduce((s, c) => s + c.recu, 0);
        t.total = Math.max(m.taille, l.reduce((s, c) => s + c.total, 0));
        if (o.status === 'success') return;
      }
    }
    throw new Error('Téléchargement interrompu par le moteur d\'IA');
  } finally {
    clearTimeout(minuterie);
  }
}

export async function installer(id) {
  if (etatTache.tache?.etat === 'en cours') throw new Error('Un téléchargement est déjà en cours');
  const e = await etat();
  const m = e.modeles.find((x) => x.id === id);
  if (!m) throw new Error('Modèle inconnu');
  if (!e.possible) throw new Error(e.raison);
  if (m.bloque) throw new Error(m.bloque);
  if (!(await enLigne())) throw new Error(HORS_LIAISON);
  if (e.disque && e.disque.libre < m.taille + MARGE) {
    throw new Error(`Espace disque insuffisant : ${octets(m.taille + MARGE)} nécessaires, ${octets(e.disque.libre)} libres.`);
  }
  const t = { id, etat: 'en cours', statut: 'Connexion au registre', recu: 0, total: m.taille, erreur: null };
  const controle = new AbortController();
  etatTache.tache = t;
  etatTache.controle = controle;
  telecharger(m, t, controle)
    .then(async () => {
      const installe = (await sonder()).installes.find((i) => i.tag === m.tag);
      if (!installe) throw new Error('Le modèle n\'apparaît pas dans le moteur d\'IA après le téléchargement');
      const avertissement = installe.digest.replace(/^sha256:/, '').startsWith(m.empreinte) ? null
        : `Version différente de celle vérifiée pour ODIN (empreinte ${installe.digest.replace(/^sha256:/, '').slice(0, 12)} au lieu de ${m.empreinte}).`;
      await ecrireJson(ETAT, { modele: m.id, actif: true, installe_le: new Date().toISOString(), avertissement }, 1);
      // First load on the card, right away: says whether the GPU is really used
      t.statut = 'Premier chargement du modèle';
      await tester().catch((err) => { t.avertissement = `Test de chargement impossible : ${err.message}`; });
      t.etat = 'termine';
    })
    .catch((err) => {
      const raison = controle.signal.reason;
      t.etat = raison === 'annule' ? 'annule' : 'erreur';
      t.erreur = message(err, raison);
    })
    .finally(() => { etatTache.controle = null; });
  return t;
}

export function annuler() {
  if (!etatTache.controle) return false;
  etatTache.controle.abort('annule');
  return true;
}

// Loads the model with a one-word answer, then reads where Ollama put it (/api/ps): the whole model
// in video memory, or partly (or wholly) on the CPU — the answers are then much slower.
export async function tester() {
  const choix = await lireJson(ETAT, {});
  const m = (await catalogue()).find((x) => x.id === choix.modele);
  if (!m || !url()) throw new Error('Aucun modèle installé');
  const debut = Date.now();
  const r = await fetch(`${url()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: m.tag, prompt: 'Réponds par un seul mot : bonjour.', stream: false, think: false, keep_alive: '30m', options: { num_predict: 16 } }),
    signal: AbortSignal.timeout(DELAI_TEST)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Ollama : ${r.status}`);
  const ps = await fetch(`${url()}/api/ps`, { signal: AbortSignal.timeout(5000) }).then((x) => x.json()).catch(() => ({}));
  const p = (ps.models || []).find((x) => x.name === m.tag || x.model === m.tag);
  const verification = {
    le: new Date().toISOString(),
    duree: Date.now() - debut,
    // Share of the model in video memory: 1 = all on the card
    gpu: p?.size ? p.size_vram / p.size : null,
    motsParSeconde: j.eval_count && j.eval_duration ? j.eval_count / (j.eval_duration / 1e9) : null
  };
  await ecrireJson(ETAT, { ...(await lireJson(ETAT, {})), verification }, 1);
  return verification;
}

export async function activer(actif) {
  const choix = await lireJson(ETAT, {});
  if (!choix.modele) throw new Error('Aucun modèle installé');
  await ecrireJson(ETAT, { ...choix, actif: actif === true }, 1);
}

export async function desinstaller(id) {
  if (etatTache.tache?.etat === 'en cours') throw new Error('Un téléchargement est en cours');
  const m = (await catalogue()).find((x) => x.id === id);
  if (!m) throw new Error('Modèle inconnu');
  if (!url()) throw new Error(RAISONS.moteur);
  const r = await fetch(`${url()}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: m.tag }),
    signal: AbortSignal.timeout(30000)
  }).catch(() => null);
  // 404: already gone (removed by hand), which is what was asked
  if (!r || (!r.ok && r.status !== 404)) throw new Error(r ? `Ollama : ${(await r.text()).slice(0, 200)}` : RAISONS.moteur);
  const choix = await lireJson(ETAT, {});
  if (choix.modele === id) await ecrireJson(ETAT, {}, 1);
  if (etatTache.tache?.id === id) etatTache.tache = null;
}

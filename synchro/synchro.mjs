import { promises as fs } from 'fs';
import path from 'path';

const API = process.env.OPENWEBUI_URL || 'http://ia:8080';
const COLLECTION = process.env.COLLECTION || 'Mes documents';
const INTERVALLE = Number(process.env.INTERVALLE || 60) * 1000;
const RACINE = '/documents';
const ETAT = '/state/etat.json';
const EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.docx', '.odt', '.html', '.csv', '.pptx', '.xlsx', '.epub']);

// Modèles à cacher du sélecteur de conversation (ils ne savent pas discuter)
const A_MASQUER = (process.env.MODELES_MASQUES || 'bge-m3:latest').split(',').filter(Boolean);

const log = (...a) => console.log(new Date().toISOString(), ...a);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let jeton = null;
let masques = false;

// Sans comptes, Open WebUI utilise un administrateur par défaut
async function connexion() {
  if (process.env.OPENWEBUI_API_KEY) { jeton = process.env.OPENWEBUI_API_KEY; return; }
  const r = await fetch(`${API}/api/v1/auths/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@localhost', password: 'admin' })
  });
  if (!r.ok) throw new Error(`connexion à Open WebUI refusée (${r.status})`);
  jeton = (await r.json()).token;
}

async function api(methode, chemin, corps) {
  const opts = { method: methode, headers: { Authorization: `Bearer ${jeton}` } };
  if (corps instanceof FormData) opts.body = corps;
  else if (corps !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(corps);
  }
  const r = await fetch(API + chemin, opts);
  const texte = await r.text();
  if (!r.ok) throw new Error(`${methode} ${chemin} -> ${r.status} ${texte.slice(0, 200)}`);
  return texte ? JSON.parse(texte) : null;
}

async function masquerModeles() {
  for (const id of A_MASQUER) {
    try {
      const q = encodeURIComponent(id);
      let modele = await api('GET', `/api/v1/models/model?id=${q}`).catch(() => null);
      if (!modele) {
        modele = await api('POST', '/api/v1/models/create', {
          id, name: id, base_model_id: null, meta: {}, params: {}, access_control: null, is_active: false
        });
      }
      if (modele?.is_active) await api('POST', `/api/v1/models/model/toggle?id=${q}`);
      log(`Modèle caché du sélecteur : ${id}`);
    } catch (e) {
      log(`Impossible de cacher ${id} :`, e.message);
    }
  }
  masques = true;
}

async function collection() {
  const res = await api('GET', '/api/v1/knowledge/');
  const liste = Array.isArray(res) ? res : res?.items || [];
  const trouvee = liste.find((k) => k.name === COLLECTION);
  if (trouvee) return trouvee.id;
  log(`Création de la collection "${COLLECTION}"`);
  const creee = await api('POST', '/api/v1/knowledge/create', {
    name: COLLECTION,
    description: 'Synchronisée automatiquement depuis les documents ODIN'
  });
  return creee.id;
}

async function lister(dossier, base = '') {
  const resultat = [];
  for (const e of await fs.readdir(dossier, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dossier, e.name);
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) resultat.push(...await lister(abs, rel));
    else if (EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
      const s = await fs.stat(abs);
      resultat.push({ rel, abs, mtime: s.mtimeMs, taille: s.size });
    }
  }
  return resultat;
}

async function lireEtat() {
  try { return JSON.parse(await fs.readFile(ETAT, 'utf8')); } catch { return { collection: null, fichiers: {} }; }
}

async function ecrireEtat(etat) {
  await fs.writeFile(ETAT + '.tmp', JSON.stringify(etat, null, 1));
  await fs.rename(ETAT + '.tmp', ETAT);
}

async function retirer(kid, fileId) {
  try { await api('POST', `/api/v1/knowledge/${kid}/file/remove`, { file_id: fileId }); }
  catch (e) { log('  retrait impossible :', e.message); }
  try { await api('DELETE', `/api/v1/files/${fileId}`); } catch {}
}

async function ajouter(kid, f) {
  const fd = new FormData();
  fd.append('file', new Blob([await fs.readFile(f.abs)]), f.rel.replaceAll('/', ' - '));
  const fichier = await api('POST', '/api/v1/files/', fd);

  // Le fichier peut encore être en cours de traitement : on réessaie pendant une minute
  for (let i = 1; ; i++) {
    try {
      await api('POST', `/api/v1/knowledge/${kid}/file/add`, { file_id: fichier.id });
      return fichier.id;
    } catch (e) {
      if (i >= 12) {
        await api('DELETE', `/api/v1/files/${fichier.id}`).catch(() => {});
        throw e;
      }
      await pause(5000);
    }
  }
}

async function synchroniser() {
  const kid = await collection();
  let etat = await lireEtat();
  if (etat.collection !== kid) etat = { collection: kid, fichiers: {} };

  const presents = new Set();
  for (const f of await lister(RACINE)) {
    presents.add(f.rel);
    const connu = etat.fichiers[f.rel];
    if (connu && connu.mtime === f.mtime && connu.taille === f.taille) continue;

    if (connu?.id) { log(`Modifié : ${f.rel}`); await retirer(kid, connu.id); }
    else log(`Nouveau : ${f.rel}`);

    try {
      const id = await ajouter(kid, f);
      etat.fichiers[f.rel] = { id, mtime: f.mtime, taille: f.taille };
      log('  indexé');
    } catch (e) {
      // On mémorise l'échec pour ne pas réessayer en boucle tant que le fichier ne change pas
      etat.fichiers[f.rel] = { echec: true, mtime: f.mtime, taille: f.taille };
      log(`  échec : ${e.message}`);
    }
    await ecrireEtat(etat);
  }

  for (const [rel, info] of Object.entries(etat.fichiers)) {
    if (presents.has(rel)) continue;
    log(`Supprimé : ${rel}`);
    if (info.id) await retirer(kid, info.id);
    delete etat.fichiers[rel];
    await ecrireEtat(etat);
  }
}

async function boucle() {
  try {
    if (!jeton) await connexion();
    if (!masques) await masquerModeles();
    await synchroniser();
  } catch (e) {
    log('Erreur :', e.message);
    jeton = null;
  }
  setTimeout(boucle, INTERVALLE);
}

// Au démarrage de la machine, Docker relance tous les conteneurs en même temps (depends_on ignoré) :
// on attend qu'Open WebUI réponde, 3 minutes au plus, avant le premier cycle
async function attendreOpenWebUI() {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {}
    if (i === 0) log('En attente d\'Open WebUI');
    await pause(2000);
  }
}

log(`Synchronisation de ${RACINE} vers "${COLLECTION}", toutes les ${INTERVALLE / 1000} s`);
attendreOpenWebUI().then(boucle);

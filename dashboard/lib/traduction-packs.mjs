import { promises as fs, createReadStream } from 'fs';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import { telechargerFlux } from './telechargements.mjs';
import { enLigne, HORS_LIAISON } from './liaison.mjs';
import { reserver, liberer, disquePlein } from './espace.mjs';
import { ecrireTexte, lireJson } from './fichiers.mjs';
import { invaliderEspace } from './espace-cache.mjs';

// Language packs of the offline translation. The dashboard downloads, checks and unpacks the Argos
// models into the folder shared with LibreTranslate (read-only on its side), then writes the signal
// file .recharger: the entry point of the libretranslate service watches it and reloads gunicorn
// (HUP), as kiwix-serve watches library.xml. No Docker socket.
// A pack: the models xx→en and en→xx, and the MiniSBD sentence splitter used for xx.
// An installed model is recognised by the SHA-256 of its archive, written in its folder (odin-sha256):
// the folder name inside the archive does not follow the file name.
const DOSSIER = process.env.TRADUCTION_DOSSIER || '/traduction';
const PAQUETS = path.join(DOSSIER, 'packages');
const DECOUPAGE = path.join(DOSSIER, 'minisbd');
// Work folder on the same volume: a finished model is moved into packages/ in one rename, so a
// reload never sees a partial model. Emptied at startup: an interrupted installation leaves nothing.
const EN_COURS = path.join(DOSSIER, '.en-cours');
const SIGNAL = path.join(DOSSIER, '.recharger');
// Both paths can be changed for a test in a separate folder (tests of a wrong fingerprint)
const CATALOGUE = process.env.TRADUCTION_CATALOGUE || '/catalogue/traduction.json';
const INACTIVITE = 30000;
const SHA = /^[0-9a-f]{64}$/;
const CODE = /^[a-z]{2,3}(-[a-z]{2,4})?$/;

// operations: installations and removals in progress; modifie: packages/ or minisbd/ changed since the last signal
const etat = globalThis.__odinTraduction ??= { taches: new Map(), controles: new Map(), attendu: null, operations: 0, modifie: false };

// Catalogue checked entry by entry: an invalid entry is ignored with a message in the logs
export async function lireCatalogue() {
  const c = await lireJson(CATALOGUE, null);
  if (!c || !Array.isArray(c.langues)) return { base: [], langues: [], decoupage: {} };
  const fichierValide = (f) => f && typeof f.url === 'string' && f.url.startsWith('https://') && SHA.test(f.sha256 || '') && Number.isInteger(f.taille);
  const decoupage = {};
  for (const [code, f] of Object.entries(c.decoupage || {})) {
    if (CODE.test(code) && fichierValide(f)) decoupage[code] = f;
    else console.error(`Traduction : modèle de découpage ${code} invalide dans le catalogue, ignoré`);
  }
  const langues = c.langues.filter((l) => {
    const ok = CODE.test(l?.code || '') && typeof l.nom === 'string' && decoupage[l.decoupage]
      && Array.isArray(l.modeles) && l.modeles.every(fichierValide);
    if (!ok) console.error(`Traduction : langue ${l?.code} invalide dans le catalogue, ignorée`);
    return ok;
  });
  return { base: Array.isArray(c.base) ? c.base : [], langues, decoupage };
}

// sha256 → folder, for every model installed by ODIN
async function modelesInstalles() {
  const m = new Map();
  for (const d of await fs.readdir(PAQUETS).catch(() => [])) {
    const sha = (await fs.readFile(path.join(PAQUETS, d, 'odin-sha256'), 'utf8').catch(() => '')).trim();
    if (SHA.test(sha)) m.set(sha, d);
  }
  return m;
}

const existe = (p) => fs.access(p).then(() => true, () => false);
const fichierDecoupage = (code) => path.join(DECOUPAGE, `${code}.onnx`);

async function estInstallee(l, modeles) {
  return l.modeles.every((f) => modeles.has(f.sha256)) && existe(fichierDecoupage(l.decoupage));
}

// List for the configuration page: base languages first, then by French name
export async function listeLangues() {
  const [{ base, langues }, modeles] = await Promise.all([lireCatalogue(), modelesInstalles()]);
  const liste = await Promise.all(langues.map(async (l) => ({
    code: l.code,
    nom: l.nom,
    remarque: l.remarque || null,
    taille: l.modeles.reduce((s, f) => s + f.taille, 0),
    base: base.includes(l.code),
    installee: await estInstallee(l, modeles),
    tache: etat.taches.get(l.code) || null
  })));
  return liste.sort((a, b) => (b.base - a.base) || a.nom.localeCompare(b.nom, 'fr'));
}

// French names by code of the LibreTranslate API, for the translation page
export async function nomsLangues() {
  const { langues } = await lireCatalogue();
  return Object.fromEntries(langues.map((l) => [l.api || l.code, l.nom]));
}

export async function languesInstallees() {
  const [{ langues }, modeles] = await Promise.all([lireCatalogue(), modelesInstalles()]);
  const r = [];
  for (const l of langues) if (await estInstallee(l, modeles)) r.push(l.code);
  return r;
}

// Folders and files of each installed language, for the space used (/sante). A MiniSBD model shared
// by two languages (tr.onnx: tr and az) is counted once, with the language of that code if installed.
export async function fichiersLangues() {
  const [{ base, langues }, modeles] = await Promise.all([lireCatalogue(), modelesInstalles()]);
  const installees = [];
  for (const l of langues) if (await estInstallee(l, modeles)) installees.push(l);
  const decoupages = new Set();
  const ordre = [...installees].sort((a, b) => (b.code === b.decoupage) - (a.code === a.decoupage));
  const liste = ordre.map((l) => {
    const chemins = l.modeles.map((f) => path.join(PAQUETS, modeles.get(f.sha256)));
    if (!decoupages.has(l.decoupage)) { decoupages.add(l.decoupage); chemins.push(fichierDecoupage(l.decoupage)); }
    return { code: l.code, nom: l.nom, base: base.includes(l.code), chemins };
  });
  return { langues: liste, enCours: EN_COURS };
}

// SHA-256 of a file, streamed
function empreinte(fichier) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(fichier).on('error', reject).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

function executer(commande, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(commande, args);
    let journal = '';
    p.stderr.on('data', (d) => { journal = (journal + d).slice(-2000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${commande} : ${journal.trim() || `code ${code}`}`))));
  });
}

// One signal after the last of simultaneous operations (installations, removals), if one changed a model
async function signaler(codes) {
  if (--etat.operations > 0 || !etat.modifie) return;
  etat.modifie = false;
  etat.attendu = { depuis: Date.now(), langues: codes };
  await ecrireTexte(SIGNAL, `${Date.now()}\n`).catch((e) => console.error(`Traduction : signal de rechargement impossible : ${e.message}`));
}

// While LibreTranslate reloads its models: true until it lists the installed languages (60 s at most)
export async function rechargement(servies) {
  const a = etat.attendu;
  if (!a) return false;
  if (Date.now() - a.depuis > 60000) { etat.attendu = null; return false; }
  // Codes of the LibreTranslate API: pt-BR, zh-Hans, zh-Hant for the Argos models pb, zh, zt
  const { langues } = await lireCatalogue();
  const attendues = (await languesInstallees()).map((c) => langues.find((l) => l.code === c)?.api || c);
  if (servies && attendues.length === servies.length && attendues.every((c) => servies.includes(c))) {
    etat.attendu = null;
    return false;
  }
  return true;
}

export async function installer(code) {
  const courante = etat.taches.get(code);
  if (courante?.etat === 'en cours') return courante;
  const { langues, decoupage } = await lireCatalogue();
  const l = langues.find((x) => x.code === code);
  if (!l) throw new Error('Langue inconnue');
  if (!(await enLigne())) throw new Error(HORS_LIAISON);

  const modeles = await modelesInstalles();
  const fichiers = l.modeles.filter((f) => !modeles.has(f.sha256)).map((f) => ({ ...f, type: 'modele' }));
  if (!(await existe(fichierDecoupage(l.decoupage)))) fichiers.push({ ...decoupage[l.decoupage], type: 'decoupage', code: l.decoupage });
  if (!fichiers.length) return { etat: 'termine', recu: 0, total: 0, erreur: null };
  const t = { etat: 'en cours', recu: 0, total: fichiers.reduce((s, f) => s + f.taille, 0), erreur: null };
  const c = new AbortController();
  etat.taches.set(code, t);
  etat.controles.set(code, c);
  etat.operations++;
  const travail = path.join(EN_COURS, code);
  installerFichiers(l, fichiers, travail, t, c)
    .catch((err) => {
      if (c.signal.reason === 'annule') { t.etat = 'annule'; return; }
      t.etat = 'erreur';
      t.erreur = disquePlein(err) || (c.signal.reason === 'inactif' ? 'Connexion perdue : aucune donnée reçue depuis 30 s'
        : err.message === 'fetch failed' ? 'Connexion impossible : internet est-il joignable ?'
        : err.message);
      console.error(`Traduction, langue ${code} : ${t.erreur}`);
    })
    .finally(async () => {
      etat.controles.delete(code);
      liberer(`traduction:${code}`);
      // After a connection error, the downloaded parts stay for « Réessayer » (resumed); nothing else
      if (t.etat === 'erreur') {
        for (const n of await fs.readdir(travail).catch(() => [])) {
          if (!n.endsWith('.part')) await fs.rm(path.join(travail, n), { recursive: true, force: true });
        }
        await fs.rmdir(travail).catch(() => {});
      } else {
        await fs.rm(travail, { recursive: true, force: true });
      }
      await fs.rmdir(EN_COURS).catch(() => {});
      await signaler(await languesInstallees());
      invaliderEspace();
    });
  return t;
}

async function installerFichiers(l, fichiers, travail, t, controle) {
  await fs.mkdir(travail, { recursive: true });
  // Archive and unpacked copy side by side
  const total = t.total;
  await reserver(`traduction:${l.code}`, DOSSIER, total * 2, () => (total - t.recu) * 2);

  // 1. Download and check everything before touching packages/
  const prets = [];
  let base = 0;
  for (const f of fichiers) {
    const part = path.join(travail, `${f.sha256}.part`);
    // Progress over all the files: telechargerFlux sets recu for its own file only
    const sous = { get recu() { return t.recu - base; }, set recu(v) { t.recu = base + v; } };
    // Complete from a previous try: only checked again
    const deja = (await fs.stat(part).catch(() => null))?.size || 0;
    for (let essai = 1; deja < f.taille; essai++) {
      const avant = t.recu;
      try {
        await telechargerFlux(f.url, part, sous, controle, { inactivite: INACTIVITE, maximum: f.taille });
        break;
      } catch (err) {
        if (controle.signal.aborted || err.message !== 'fetch failed' || t.recu !== avant || essai >= 3) throw err;
        console.error(`Traduction, langue ${l.code} : connexion impossible (${err.cause?.code || err.cause?.message || 'cause inconnue'}), nouvel essai ${essai + 1}/3`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    if ((await empreinte(part)) !== f.sha256) {
      await fs.rm(part, { force: true });
      throw new Error(`Empreinte incorrecte pour ${path.basename(f.url)} : fichier supprimé, rien n'est installé.`);
    }
    base += f.taille;
    t.recu = base;
    prets.push({ ...f, part });
  }

  // 2. Unpack each model in the work folder, readable by LibreTranslate (UID 1032)
  const deplacer = [];
  for (const [i, f] of prets.entries()) {
    if (f.type === 'decoupage') {
      await fs.chmod(f.part, 0o644);
      deplacer.push({ de: f.part, vers: fichierDecoupage(f.code) });
      continue;
    }
    const x = path.join(travail, `x${i}`);
    await fs.mkdir(x);
    await executer('unzip', ['-q', f.part, '-d', x]);
    await fs.rm(f.part, { force: true });
    const racines = await fs.readdir(x);
    if (racines.length !== 1) throw new Error(`Archive inattendue : ${path.basename(f.url)}`);
    const dossier = path.join(x, racines[0]);
    await fs.writeFile(path.join(dossier, 'odin-sha256'), `${f.sha256}\n`);
    await executer('chmod', ['-R', 'u+rwX,go+rX,go-w', dossier]);
    deplacer.push({ de: dossier, vers: path.join(PAQUETS, racines[0]) });
  }

  // 3. Into place, one rename each. A folder of the same name (older version, leftover) is replaced.
  await fs.mkdir(PAQUETS, { recursive: true });
  await fs.mkdir(DECOUPAGE, { recursive: true });
  etat.modifie = true;
  for (const { de, vers } of deplacer) {
    await fs.rm(vers, { recursive: true, force: true });
    await fs.rename(de, vers);
  }
  t.recu = t.total;
  t.etat = 'termine';
}

export function annuler(code) {
  const c = etat.controles.get(code);
  if (!c) return false;
  c.abort('annule');
  return true;
}

// Removes the models of a language; a MiniSBD model shared with another installed language stays
export async function desinstaller(code) {
  const { base, langues } = await lireCatalogue();
  const l = langues.find((x) => x.code === code);
  if (!l) throw new Error('Langue inconnue');
  if (base.includes(code)) throw new Error('Le français et l\'anglais ne se désinstallent pas.');
  if (etat.taches.get(code)?.etat === 'en cours') throw new Error('Installation en cours : annulez-la d\'abord.');
  etat.operations++;
  try {
    const modeles = await modelesInstalles();
    const autres = [];
    for (const x of langues) if (x.code !== code && (base.includes(x.code) || await estInstallee(x, modeles))) autres.push(x);
    await fs.mkdir(EN_COURS, { recursive: true });
    etat.modifie = true;
    for (const f of l.modeles) {
      const d = modeles.get(f.sha256);
      if (!d) continue;
      // Out of packages/ in one rename, then deleted
      const corbeille = path.join(EN_COURS, `retrait-${d}-${Date.now()}`);
      await fs.rename(path.join(PAQUETS, d), corbeille);
      await fs.rm(corbeille, { recursive: true, force: true });
    }
    if (!autres.some((x) => x.decoupage === l.decoupage)) await fs.rm(fichierDecoupage(l.decoupage), { force: true });
    etat.taches.delete(code);
  } finally {
    await fs.rmdir(EN_COURS).catch(() => {});
    await signaler(await languesInstallees());
    invaliderEspace();
  }
}

// At startup: nothing left by an interrupted installation. A language with only part of its models
// in packages/ (stopped between two renames) is removed, so that it never looks installed.
export async function nettoyerTraduction() {
  await fs.rm(EN_COURS, { recursive: true, force: true });
  // Download folder of the installer before the language packs (empty)
  await fs.rmdir(path.join(DOSSIER, '.telechargements')).catch(() => {});
  const { base, langues } = await lireCatalogue();
  const modeles = await modelesInstalles();
  let retire = false;
  for (const l of langues) {
    if (base.includes(l.code)) continue;
    const presents = l.modeles.filter((f) => modeles.has(f.sha256));
    if (presents.length === 0 || presents.length === l.modeles.length) continue;
    for (const f of presents) await fs.rm(path.join(PAQUETS, modeles.get(f.sha256)), { recursive: true, force: true });
    console.error(`Traduction : langue ${l.code} incomplète (installation interrompue), retirée`);
    retire = true;
  }
  if (retire) { etat.operations++; etat.modifie = true; await signaler(await languesInstallees()); }
}

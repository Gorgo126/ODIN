import { promises as fs, createReadStream } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { telechargerFlux } from './telechargements.mjs';
import { reserver, liberer, disquePlein } from './espace.mjs';
import { ecrireJson, lireJson } from './fichiers.mjs';
import { enLigne, HORS_LIAISON } from './liaison.mjs';
import { extrairePages } from './extraction.mjs';

// Book packs (PDF): unlike ZIM packs, every piece of metadata, size and SHA-256 included,
// comes from our own catalogue, so a book can be described and checked offline.
const DOSSIER = '/livres';
const EN_COURS = path.join(DOSSIER, '.en-cours');
const CATALOGUE = '/catalogue/livres.json';
// Time allowed to get the HTTP response; there is no inactivity timeout once data flows
const CONNEXION = 15000;
// Room for the extracted text next to the PDF
const MARGE = 1.15;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const etat = globalThis.__odinLivres ??= { taches: new Map(), controles: new Map(), demarrages: new Map(), extractions: new Map() };

const texte = (v) => typeof v === 'string' && v.trim() !== '';
const https = (v) => texte(v) && /^https:\/\/[^\s]+$/.test(v);

// Reason why a catalogue entry is unusable, or null
function defaut(e) {
  if (!e || typeof e !== 'object') return 'entrée illisible';
  if (!texte(e.id) || !ID.test(e.id)) return 'identifiant invalide';
  if (e.type !== 'pdf') return 'type non pris en charge';
  for (const champ of ['titre', 'editeur', 'langue', 'categorie', 'attribution']) {
    if (!texte(e[champ])) return `champ « ${champ} » manquant`;
  }
  if (!Array.isArray(e.auteurs) || !e.auteurs.length || !e.auteurs.every(texte)) return 'auteurs manquants';
  if (!texte(e.licence?.nom) || !https(e.licence?.url)) return 'licence incomplète';
  if (!Array.isArray(e.sources) || !e.sources.length || !e.sources.every(https)) return 'sources invalides (https requis)';
  if (!/^[0-9a-f]{64}$/.test(e.sha256 || '')) return 'SHA-256 invalide';
  if (!Number.isInteger(e.taille) || e.taille <= 0) return 'taille invalide';
  return null;
}

// Valid entries only: a broken entry is logged and skipped, never breaks the page
export async function lireCatalogue() {
  let brut;
  try {
    brut = JSON.parse(await fs.readFile(CATALOGUE, 'utf8'));
  } catch (e) {
    console.error(`Catalogue des livres illisible : ${e.message}`);
    return [];
  }
  if (!Array.isArray(brut)) return [];
  const vus = new Set();
  return brut.filter((e) => {
    const d = defaut(e) || (vus.has(e.id) ? 'identifiant en double' : null);
    if (d) console.error(`Catalogue des livres, entrée ${e?.id ?? '?'} ignorée : ${d}`);
    else vus.add(e.id);
    return !d;
  });
}

export const dossierLivre = (id) => path.join(DOSSIER, id);
const lireFiche = (id) => lireJson(path.join(dossierLivre(id), 'fiche.json'), null);

async function empreinte(fichier) {
  const h = createHash('sha256');
  for await (const morceau of createReadStream(fichier)) h.update(morceau);
  return h.digest('hex');
}

// Installed books, from their fiche.json: still listed if their entry left the catalogue
async function installes() {
  const noms = await fs.readdir(DOSSIER).catch(() => []);
  const fiches = await Promise.all(noms.filter((n) => ID.test(n)).map(async (n) => {
    const f = await lireFiche(n);
    if (f?.id !== n) return null;
    // Text extracted for the search: false until the extraction has succeeded
    const texte = !!(await fs.stat(path.join(dossierLivre(n), 'pages.json')).catch(() => null));
    return { ...f, texte };
  }));
  return new Map(fiches.filter(Boolean).map((f) => [f.id, f]));
}

// Installed book for reading, or null: unknown, dangerous or not installed identifiers alike
export async function livreInstalle(id) {
  if (typeof id !== 'string' || !ID.test(id)) return null;
  const fiche = await lireFiche(id);
  return fiche?.id === id ? fiche : null;
}

export async function livresInstalles() {
  return [...(await installes()).values()].sort((a, b) => a.titre.localeCompare(b.titre, 'fr'));
}

// Page asked in the URL, kept within the book: 1 when missing or unreadable, the last one beyond
export function pageDemandee(brut, pages) {
  const n = /^\d+$/.test(String(brut ?? '')) ? Number(brut) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) return 1;
  return Number.isInteger(pages) && pages > 0 ? Math.min(n, pages) : n;
}

export const AVERTISSEMENT_SANTE = 'Guide de santé : en cas de doute, consultez un soignant. Vérifiez toujours les doses de médicaments dans le livre.';

// Served by Caddy (Range requests), see the /livres-fichiers route of the Caddyfile
export const urlFichier = (id) => `/livres-fichiers/${id}/document.pdf`;

export async function listeLivres() {
  const [catalogue, fiches] = await Promise.all([lireCatalogue(), installes()]);
  const liste = catalogue.map((e) => ({
    ...e,
    installe: fiches.has(e.id),
    fiche: fiches.get(e.id) || null,
    tache: etat.taches.get(e.id) || null
  }));
  for (const [id, f] of fiches) {
    if (!liste.some((l) => l.id === id)) liste.push({ ...f, installe: true, fiche: f, horsCatalogue: true, tache: null });
  }
  return liste;
}

// One line per failed source, turned into the message shown under « Réessayer »
function messageEchec(echecs) {
  const refus = echecs.some((e) => e.raison === 'empreinte');
  const plusieurs = echecs.length > 1;
  if (!refus) {
    return plusieurs
      ? 'Source et miroir injoignables. Vérifiez l\'accès à internet, puis réessayez.'
      : 'Source injoignable. Vérifiez l\'accès à internet, puis réessayez.';
  }
  const parties = echecs.map((e) => e.raison === 'empreinte'
    ? (e.nom === 'source' ? 'le fichier publié par l\'éditeur a changé et ne correspond plus au catalogue d\'ODIN' : 'le fichier du miroir ne correspond pas non plus')
    : (e.nom === 'source' ? 'la source est injoignable' : 'le miroir d\'ODIN est injoignable'));
  const phrase = parties.join(' ; ');
  const toutes = echecs.every((e) => e.raison === 'empreinte');
  return `${phrase[0].toUpperCase()}${phrase.slice(1)}. Installation refusée par sécurité : aucun fichier non vérifié n'est installé.`
    + (toutes ? ' Une mise à jour d\'ODIN est nécessaire.' : '');
}

function raisonReseau(err, essai) {
  if (essai.signal.reason === 'connexion') return `pas de réponse en ${CONNEXION / 1000} s`;
  if (err.message === 'fetch failed') return err.cause?.code || 'connexion impossible';
  return err.message;
}

async function installer(livre, t, c) {
  const part = path.join(EN_COURS, `${livre.id}.part`);
  const echecs = [];

  for (const [i, url] of livre.sources.entries()) {
    const nom = i === 0 ? 'source' : 'miroir';
    t.source = nom;
    t.recu = 0;
    // Never resume across sources: a partial file from another server could differ
    await fs.rm(part, { force: true });

    const essai = new AbortController();
    const relayer = () => essai.abort('annule');
    c.signal.addEventListener('abort', relayer, { once: true });
    try {
      await telechargerFlux(url, part, t, essai, { inactivite: null, connexion: CONNEXION, maximum: Math.ceil(livre.taille * 1.1) });
    } catch (err) {
      if (c.signal.aborted) throw err;
      await fs.rm(part, { force: true });
      // A file much larger than announced was replaced at the source: same verdict as a wrong hash
      const raison = essai.signal.reason === 'trop-gros' ? 'empreinte' : raisonReseau(err, essai);
      console.error(`Livre ${livre.id}, ${nom} ${url} : ${raison === 'empreinte' ? 'fichier plus gros que prévu' : raison}`);
      echecs.push({ nom, raison });
      continue;
    } finally {
      c.signal.removeEventListener('abort', relayer);
    }

    t.verification = true;
    const recue = await empreinte(part);
    t.verification = false;
    if (recue !== livre.sha256) {
      console.error(`Livre ${livre.id}, ${nom} ${url} : empreinte différente, attendue ${livre.sha256}, reçue ${recue}`);
      await fs.rm(part, { force: true });
      echecs.push({ nom, raison: 'empreinte' });
      continue;
    }

    // Assembled aside, then moved in one rename: a half-installed book is never visible
    const tmp = path.join(EN_COURS, livre.id);
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(tmp, { recursive: true });
    await fs.rename(part, path.join(tmp, 'document.pdf'));
    t.extraction = true;
    await extraire(path.join(tmp, 'document.pdf'), path.join(tmp, 'pages.json'), livre.id);
    t.extraction = false;
    await ecrireJson(path.join(tmp, 'fiche.json'), {
      ...livre,
      verifie: { sha256: recue, source: nom, url, date: new Date().toISOString() }
    }, 1);
    await fs.rename(tmp, dossierLivre(livre.id));
    return;
  }
  throw new Error(messageEchec(echecs));
}

// Text of the book for the search. A failure leaves the book readable, not searchable: the
// extraction is tried again at the next start (rattraperTextes).
async function extraire(pdf, sortie, id) {
  try {
    const t0 = Date.now();
    const pages = await extrairePages(pdf);
    await ecrireJson(sortie, pages);
    console.log(`Livre ${id} : texte extrait, ${pages.length} pages en ${Date.now() - t0} ms`);
    return true;
  } catch (e) {
    console.error(`Livre ${id} : extraction du texte impossible : ${e.message}`);
    return false;
  }
}

// At startup: books installed before the search existed, or whose extraction failed
export async function rattraperTextes() {
  for (const l of await livresInstalles()) {
    if (l.texte || etat.extractions.has(l.id)) continue;
    const dossier = dossierLivre(l.id);
    const travail = extraire(path.join(dossier, 'document.pdf'), path.join(dossier, 'pages.json'), l.id);
    etat.extractions.set(l.id, travail);
    await travail.finally(() => etat.extractions.delete(l.id));
  }
}

// Concurrent requests for the same book (double click, two devices) share one start:
// the reservation is taken synchronously, before any await, so only one download runs
export function demarrer(id) {
  const courante = etat.taches.get(id);
  if (courante?.etat === 'en cours') return Promise.resolve(courante);
  let demarrage = etat.demarrages.get(id);
  if (!demarrage) {
    demarrage = lancer(id).finally(() => etat.demarrages.delete(id));
    etat.demarrages.set(id, demarrage);
  }
  return demarrage;
}

async function lancer(id) {
  const livre = (await lireCatalogue()).find((l) => l.id === id);
  if (!livre) throw new Error('Livre inconnu');
  if (await lireFiche(id)) throw new Error('Livre déjà installé');
  if (!(await enLigne())) throw new Error(HORS_LIAISON);

  await fs.mkdir(EN_COURS, { recursive: true });
  const t = { etat: 'en cours', recu: 0, total: livre.taille, erreur: null, source: null, verification: false, extraction: false };
  await reserver(`livre:${id}`, DOSSIER, Math.ceil(livre.taille * MARGE), () => livre.taille - t.recu);
  const c = new AbortController();
  etat.taches.set(id, t);
  etat.controles.set(id, c);

  installer(livre, t, c)
    .then(() => {
      t.recu = t.total;
      t.etat = 'termine';
    })
    .catch(async (err) => {
      await fs.rm(path.join(EN_COURS, `${id}.part`), { force: true });
      await fs.rm(path.join(EN_COURS, id), { recursive: true, force: true });
      if (c.signal.reason === 'annule') {
        t.etat = 'annule';
        return;
      }
      t.etat = 'erreur';
      t.erreur = disquePlein(err) || err.message;
    })
    .finally(() => {
      t.verification = false;
      t.extraction = false;
      etat.controles.delete(id);
      liberer(`livre:${id}`);
    });
  return t;
}

export function annuler(id) {
  const c = etat.controles.get(id);
  if (!c) return false;
  c.abort('annule');
  return true;
}

export async function supprimer(id) {
  if (!ID.test(id)) throw new Error('Livre inconnu');
  if (etat.taches.get(id)?.etat === 'en cours') throw new Error('Téléchargement en cours : annulez-le d\'abord.');
  if (!(await lireFiche(id))) throw new Error('Livre non installé');
  await fs.rm(dossierLivre(id), { recursive: true, force: true });
  etat.taches.delete(id);
}

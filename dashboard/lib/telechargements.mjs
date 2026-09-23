import { promises as fs, createWriteStream } from 'fs';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import path from 'path';
import { lirePacks, infos } from './catalogue.mjs';
import { enLigne, HORS_LIAISON } from './liaison.mjs';
import { ecrireTexte } from './fichiers.mjs';
import { reserver, liberer, disquePlein } from './espace.mjs';

const DATA = '/data';
const LIB = path.join(DATA, 'library.xml');
const VIDE = '<?xml version="1.0" encoding="UTF-8"?>\n<library version="20110515">\n</library>\n';
const INACTIVITE = 30000;
const taches = globalThis.__odinTaches ??= new Map();
// Kept apart from taches: tasks are serialized to the browser
const controles = globalThis.__odinControles ??= new Map();

const existe = (p) => fs.access(p).then(() => true, () => false);
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Un contenu = un nom Kiwix, quelle que soit sa variante
const prefixe = (nom) => `${nom}_`;

export const tache = (id) => taches.get(id) || null;
export const nomFichier = (e) => path.basename(e.url.replace(/\.meta4$/, ''));

// absent | installe | maj (même variante, plus ancienne) | autre (autre variante)
export async function etatInstallation(pack, e) {
  const fichiers = (await fs.readdir(DATA).catch(() => []))
    .filter((f) => f.startsWith(prefixe(pack.nom)) && f.endsWith('.zim'));
  if (!fichiers.length) return 'absent';
  if (!e || fichiers.includes(nomFichier(e))) return 'installe';
  const memeVariante = fichiers.some((f) => f.startsWith(`${pack.nom}_${e.variante}_`));
  return memeVariante ? 'maj' : 'autre';
}

export async function demarrer(id) {
  const courante = taches.get(id);
  if (courante?.etat === 'en cours') return courante;

  const pack = (await lirePacks()).find((p) => p.id === id);
  if (!pack) throw new Error('Pack inconnu');
  if (!(await enLigne())) throw new Error(HORS_LIAISON);
  const e = await infos(pack);
  if (!e) throw new Error('Catalogue Kiwix injoignable ou pack introuvable');

  const t = { etat: 'en cours', recu: 0, total: e.taille, erreur: null };
  const c = new AbortController();
  taches.set(id, t);
  controles.set(id, c);
  telecharger(pack, e, t, c)
    .catch(async (err) => {
      if (c.signal.reason === 'annule') {
        t.etat = 'annule';
        await fs.rm(path.join(DATA, nomFichier(e) + '.part'), { force: true });
        return;
      }
      t.etat = 'erreur';
      t.erreur = disquePlein(err) || (c.signal.reason === 'inactif' ? 'Connexion perdue : aucune donnée reçue depuis 30 s'
        : err.message === 'fetch failed' ? 'Connexion impossible : internet est-il joignable ?'
        : err.message);
    })
    .finally(() => { controles.delete(id); liberer(`zim:${id}`); });
  return t;
}

export function annuler(id) {
  const c = controles.get(id);
  if (!c) return false;
  c.abort('annule');
  return true;
}

async function telecharger(pack, e, t, controle) {
  const fichier = nomFichier(e);
  const dest = path.join(DATA, fichier);
  const part = dest + '.part';

  if (!(await existe(dest))) {
    const deja = (await fs.stat(part).catch(() => null))?.size || 0;
    // 2 % margin; the part already received is on the disk
    await reserver(`zim:${pack.id}`, DATA, Math.ceil((e.taille - deja) * 1.02), () => e.taille - t.recu);
    // download.kiwix.org sends each request to a mirror picked at random; one may be unreachable for
    // a moment (seen on the test VM: « fetch failed » at once, fine on the next try). A connection that
    // fails before any byte is tried again, twice, 3 s apart; the cause goes to the logs.
    for (let essai = 1; ; essai++) {
      const avant = t.recu;
      try {
        await telechargerFlux(e.url.replace(/\.meta4$/, ''), part, t, controle);
        break;
      } catch (err) {
        if (controle.signal.aborted || err.message !== 'fetch failed' || t.recu !== avant || essai >= 3) throw err;
        console.error(`Pack ${pack.id} : connexion impossible (${err.cause?.code || err.cause?.message || 'cause inconnue'}), nouvel essai ${essai + 1}/3`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    await fs.rename(part, dest);
  }

  // Remplace toute autre version ou variante du même contenu
  for (const f of await fs.readdir(DATA)) {
    if (f.startsWith(prefixe(pack.nom)) && f.endsWith('.zim') && f !== fichier) {
      await fs.rm(path.join(DATA, f), { force: true });
    }
  }

  await inscrire(e, fichier, prefixe(pack.nom));
  t.recu = t.total;
  t.etat = 'termine';
}

// Read-modify-write of library.xml: two packs finishing together would otherwise drop one book
const verrou = globalThis.__odinBibliotheque ??= { suite: Promise.resolve() };
function inscrire(...args) {
  const tache = verrou.suite.then(() => inscrireMaintenant(...args));
  verrou.suite = tache.catch(() => {});
  return tache;
}

async function inscrireMaintenant(e, fichier, debut) {
  let xml = await fs.readFile(LIB, 'utf8').catch(() => VIDE);
  xml = xml.replace(/\s*<book\b[^>]*\/>/g, (b) =>
    (b.match(/path="([^"]*)"/)?.[1] || '').startsWith(debut) ? '' : b);

  const livre = `  <book id="${esc(e.uuid)}" path="${esc(fichier)}" title="${esc(e.titre)}"`
    + ` description="${esc(e.description)}" language="${esc(e.langue)}" creator="${esc(e.createur)}"`
    + ` publisher="${esc(e.editeur)}" name="${esc(e.nom)}" flavour="${esc(e.variante)}"`
    + ` tags="${esc(e.tags)}" date="${esc(e.date)}" articleCount="${e.articles}"`
    + ` mediaCount="${e.medias}" size="${Math.round(e.taille / 1024)}" />`;

  xml = xml.replace('</library>', `${livre}\n</library>`);
  await ecrireTexte(LIB, xml);
}

// Streams url into part, resuming it if present. inactivite: ms without data before
// aborting (headers included), or null to wait for as long as needed. connexion: ms to get
// the response headers, even without inactivity timeout. maximum: bytes beyond which the
// download is aborted (a replaced file must not fill the disk).
export async function telechargerFlux(url, part, t, controle, { inactivite = INACTIVITE, connexion = null, maximum = null } = {}) {
  let deja = (await fs.stat(part).catch(() => null))?.size || 0;
  const { signal } = controle;
  let minuterie;
  const veiller = () => {
    if (!inactivite) return;
    clearTimeout(minuterie);
    minuterie = setTimeout(() => controle.abort('inactif'), inactivite);
  };
  const attente = connexion && setTimeout(() => controle.abort('connexion'), connexion);
  try {
    veiller();
    const r = await fetch(url, { headers: deja ? { Range: `bytes=${deja}-` } : {}, signal });
    clearTimeout(attente);
    if (r.status === 200) deja = 0;
    else if (r.status !== 206) throw new Error(`Téléchargement refusé (${r.status})`);
    t.recu = deja;

    const compteur = new Transform({
      transform(c, _, cb) {
        veiller();
        t.recu += c.length;
        if (maximum && t.recu > maximum) controle.abort('trop-gros');
        cb(null, c);
      }
    });
    await pipeline(Readable.fromWeb(r.body), compteur, createWriteStream(part, { flags: deja ? 'a' : 'w' }), { signal });
  } finally {
    clearTimeout(attente);
    clearTimeout(minuterie);
  }
}

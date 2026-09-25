import { promises as fs, createWriteStream } from 'fs';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import path from 'path';
import { lirePacks, infos, oublierTaille } from './catalogue.mjs';
import { enLigne, HORS_LIAISON } from './liaison.mjs';
import { ecrireTexte } from './fichiers.mjs';
import { reserver, liberer, disquePlein } from './espace.mjs';
import { invaliderEspace } from './espace-cache.mjs';

const DATA = '/data';
const LIB = path.join(DATA, 'library.xml');
const VIDE = '<?xml version="1.0" encoding="UTF-8"?>\n<library version="20110515">\n</library>\n';
const INACTIVITE = 30000;
const taches = globalThis.__odinTaches ??= new Map();
// Kept apart from taches: tasks are serialized to the browser
const controles = globalThis.__odinControles ??= new Map();
// End of each running download (promise), and packs being uninstalled
const fins = globalThis.__odinFinsZim ??= new Map();
const retraits = globalThis.__odinRetraitsZim ??= new Set();

const existe = (p) => fs.access(p).then(() => true, () => false);
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Un contenu = un nom Kiwix, quelle que soit sa variante
const prefixe = (nom) => `${nom}_`;

export const tache = (id) => taches.get(id) || null;
export const nomFichier = (e) => path.basename(e.url.replace(/\.meta4$/, ''));

// ZIM files of this pack (its name, and its variant unless « - »). Two packs may share a name
// (wikipedia_fr_all nopic and maxi): only the variant tells them apart.
export async function fichiersPack(pack) {
  const debut = pack.variante === '-' ? prefixe(pack.nom) : `${pack.nom}_${pack.variante}_`;
  return (await fs.readdir(DATA).catch(() => []))
    .filter((f) => f.startsWith(debut) && f.endsWith('.zim'));
}

// absent | installe | maj (même variante, plus ancienne) | autre (autre variante)
export async function etatInstallation(pack, e) {
  const fichiers = (await fs.readdir(DATA).catch(() => []))
    .filter((f) => f.startsWith(prefixe(pack.nom)) && f.endsWith('.zim'));
  if (!fichiers.length) return 'absent';
  const siens = await fichiersPack(pack);
  // Offline (no catalogue entry): installed when a file of its own variant is there
  if (!e) return siens.length ? 'installe' : 'autre';
  if (fichiers.includes(nomFichier(e))) return 'installe';
  return siens.length ? 'maj' : 'autre';
}

export async function demarrer(id) {
  const courante = taches.get(id);
  if (courante?.etat === 'en cours') return courante;
  if (retraits.has(id)) throw new Error('Désinstallation en cours');

  const pack = (await lirePacks()).find((p) => p.id === id);
  if (!pack) throw new Error('Pack inconnu');
  if (!(await enLigne())) throw new Error(HORS_LIAISON);
  const e = await infos(pack);
  if (!e) throw new Error('Catalogue Kiwix injoignable ou pack introuvable');

  const t = { etat: 'en cours', recu: 0, total: e.taille, erreur: null };
  const c = new AbortController();
  taches.set(id, t);
  controles.set(id, c);
  const fin = telecharger(pack, e, t, c)
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
    .finally(() => { controles.delete(id); fins.delete(id); liberer(`zim:${id}`); invaliderEspace(); });
  fins.set(id, fin);
  return t;
}

export function annuler(id) {
  const c = controles.get(id);
  if (!c) return false;
  c.abort('annule');
  return true;
}

// Uninstalls a pack: its books out of library.xml first (kiwix-serve, --monitorLibrary, stops serving
// them; the assistant sees the new date of the file), then its files and its remembered size. A
// download of the same pack still running (update) is cancelled and awaited first, so that it can
// neither register its book afterwards nor leave its .part.
export async function supprimer(id) {
  const pack = (await lirePacks()).find((p) => p.id === id);
  if (!pack) throw new Error('Pack inconnu');
  if (retraits.has(id)) throw new Error('Désinstallation déjà en cours');
  retraits.add(id);
  try {
    if (annuler(id)) await fins.get(id)?.catch(() => {});
    const fichiers = await fichiersPack(pack);
    if (!fichiers.length) throw new Error('Ce pack n\'est pas installé');
    await retirer(new Set(fichiers));
    for (const f of fichiers) await fs.rm(path.join(DATA, f), { force: true });
    await oublierTaille(id);
    taches.delete(id);
  } finally {
    retraits.delete(id);
    invaliderEspace();
  }
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
function enFile(f) {
  const tache = verrou.suite.then(f);
  verrou.suite = tache.catch(() => {});
  return tache;
}
const inscrire = (...args) => enFile(() => inscrireMaintenant(...args));

// Removes from library.xml the books whose file is in `fichiers`
const retirer = (fichiers) => enFile(async () => {
  const xml = await fs.readFile(LIB, 'utf8').catch(() => null);
  if (xml === null) return;
  const neuf = xml.replace(/\s*<book\b[^>]*\/>/g, (b) => (fichiers.has(b.match(/path="([^"]*)"/)?.[1]) ? '' : b));
  if (neuf !== xml) await ecrireTexte(LIB, neuf);
});

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

import { promises as fs, createWriteStream, createReadStream } from 'fs';
import { createHash } from 'crypto';
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
export const INACTIVITE = 30000;
// Time allowed to a mirror to answer before the next one is tried
const CONNEXION = 15000;
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
      // The controller of the mirror in use (replaced when a mirror is skipped)
      const raison = (controles.get(id) || c).signal.reason;
      if (raison === 'annule') {
        t.etat = 'annule';
        await fs.rm(path.join(DATA, nomFichier(e) + '.part'), { force: true });
        return;
      }
      t.etat = 'erreur';
      t.erreur = disquePlein(err) || (raison === 'inactif' ? 'Connexion perdue : aucune donnée reçue depuis 30 s'
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

// Mirrors of a Kiwix file from its metalink, by priority, with the exact size and SHA-256; null when
// the metalink cannot be read (the address without .meta4 is then used, as before)
export async function metalien(url) {
  if (!url.endsWith('.meta4')) return null;
  const fichier = path.basename(url.replace(/\.meta4$/, ''));
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!r.ok) return null;
    const xml = await r.text();
    const miroirs = [...xml.matchAll(/<url\b([^>]*)>(https:\/\/[^<]+)<\/url>/g)]
      .map((m, i) => ({ p: Number(m[1].match(/priority="(\d+)"/)?.[1] ?? 1000 + i), url: m[2].replace(/&amp;/g, '&') }))
      // Mirrors of this file only (the publisher's <url> is the site of Kiwix)
      .filter((m) => m.url.endsWith(`/${fichier}`))
      .sort((a, b) => a.p - b.p)
      .map((m) => m.url);
    return {
      miroirs,
      sha256: xml.match(/<hash type="sha-256">([0-9a-f]{64})<\/hash>/)?.[1] || null,
      taille: Number(xml.match(/<size>(\d+)<\/size>/)?.[1]) || null
    };
  } catch (err) {
    console.error(`Métalien ${url} illisible (${err.cause?.code || err.name}) : adresse de redirection seule`);
    return null;
  }
}

// Mirror choice: a short throughput test of the first mirrors of the metalink, in parallel (512 KB,
// 4 s at most, the whole test included). Kiwix orders them by country, not by speed: from Belgium the
// second one gave 0.3 MB/s while another answered 35 times faster. The ranking is kept 30 minutes
// (by host, whatever the file); when no test succeeds, the order of Kiwix stays.
const ESSAIS = 4;
const OCTETS_ESSAI = 512 * 1024;
const DUREE_ESSAI = 4000;
const GARDE_CLASSEMENT = 30 * 60 * 1000;
const classements = globalThis.__odinMiroirs ??= new Map();

async function debit(url, signal) {
  const debut = Date.now();
  const r = await fetch(url, { headers: { Range: `bytes=0-${OCTETS_ESSAI - 1}` }, signal, cache: 'no-store' });
  if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`);
  let recu = 0;
  try {
    for await (const morceau of r.body) {
      recu += morceau.length;
      if (recu >= OCTETS_ESSAI) break;
    }
  } catch (e) {
    // Time is up: a slow mirror is measured on what it sent
    if (!recu) throw e;
  }
  return recu / Math.max(1, Date.now() - debut); // bytes per ms
}

export async function ordonnerMiroirs(miroirs) {
  if (miroirs.length < 2) return miroirs;
  const hote = (u) => new URL(u).hostname;
  const testes = miroirs.slice(0, ESSAIS);
  const cle = testes.map(hote).join(' ');
  let c = classements.get(cle);
  if (!c || Date.now() - c.t > GARDE_CLASSEMENT) {
    const signal = AbortSignal.timeout(DUREE_ESSAI);
    const resultats = await Promise.all(testes.map((u) => debit(u, signal).catch(() => 0)));
    c = { t: Date.now(), debits: new Map(testes.map((u, i) => [hote(u), resultats[i]])) };
    // Nothing measured (offline, all mirrors down): not kept, the next download tests again
    if (resultats.some((v) => v > 0)) classements.set(cle, c);
    console.log(`Miroirs Kiwix : ${testes.map((u, i) => `${hote(u)} ${resultats[i] ? `${(resultats[i] / 1024 * 1000 / 1024).toFixed(1)} Mo/s` : 'échec'}`).join(', ')}`);
  }
  // Fastest first; failed ones keep their Kiwix order after them; the untested ones stay last
  const tries = testes.map((u, i) => ({ u, i, v: c.debits.get(hote(u)) || 0 }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map((x) => x.u);
  return [...tries, ...miroirs.slice(ESSAIS)];
}

async function empreinteFichier(fichier) {
  const h = createHash('sha256');
  for await (const morceau of createReadStream(fichier)) h.update(morceau);
  return h.digest('hex');
}

// New controller for the next mirror (the previous one stays aborted); annuler() uses the new one
function remplacer(id, ancien) {
  const c = new AbortController();
  if (controles.get(id) === ancien) controles.set(id, c);
  return c;
}

async function telecharger(pack, e, t, controle) {
  const fichier = nomFichier(e);
  const dest = path.join(DATA, fichier);
  const part = dest + '.part';

  if (!(await existe(dest))) {
    const deja = (await fs.stat(part).catch(() => null))?.size || 0;
    // 2 % margin; the part already received is on the disk
    await reserver(`zim:${pack.id}`, DATA, Math.ceil((e.taille - deja) * 1.02), () => e.taille - t.recu);
    // download.kiwix.org sends every request to the mirror of the visitor's country (MirrorBrain). One
    // may be unreachable from a given network: on 2026-09-26, ftp.nluug.nl (first for Belgium) did not
    // answer over IPv4, only over IPv6, which the containers do not have. The metalink (.meta4) of the
    // catalogue lists all the mirrors by priority, with the exact size and the SHA-256: each mirror is
    // tried in turn while nothing has been received from it; a transfer cut in the middle stops as
    // before (the .part stays for « Réessayer »). The files are the same on every mirror: resuming a
    // .part from another one is safe, the SHA-256 checks the whole file at the end.
    const lien = await metalien(e.url);
    if (lien?.taille) t.total = lien.taille;
    const miroirs = lien?.miroirs.length ? await ordonnerMiroirs(lien.miroirs) : [e.url.replace(/\.meta4$/, '')];
    for (const [i, url] of miroirs.entries()) {
      const avant = t.recu;
      try {
        await telechargerFlux(url, part, t, controle, { connexion: CONNEXION });
        break;
      } catch (err) {
        const reseau = err.message === 'fetch failed' || controle.signal.reason === 'connexion' || /\((404|403|5\d\d)\)/.test(err.message);
        if (controle.signal.aborted && controle.signal.reason !== 'connexion') throw err;
        if (!reseau || t.recu !== avant || i === miroirs.length - 1) throw err;
        console.error(`Pack ${pack.id} : miroir ${new URL(url).hostname} injoignable (${err.cause?.code || controle.signal.reason || err.message}), miroir suivant`);
        // A new controller: the one of the failed mirror stays aborted
        controle = remplacer(pack.id, controle);
      }
    }
    if (lien?.sha256) {
      t.verification = true;
      const recue = await empreinteFichier(part);
      t.verification = false;
      if (recue !== lien.sha256) {
        await fs.rm(part, { force: true });
        console.error(`Pack ${pack.id} : empreinte différente, attendue ${lien.sha256}, reçue ${recue}`);
        throw new Error('Fichier reçu incorrect (empreinte SHA-256 différente) : supprimé, réessayez.');
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

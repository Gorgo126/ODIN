import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { telechargerFlux } from './telechargements.mjs';
import { octets } from './format.mjs';

const DOSSIER = '/cartes';
const CATALOGUE = '/catalogue/cartes.txt';
const INDEX = 'https://build-metadata.protomaps.dev/builds.json';
const BUILDS = 'https://build.protomaps.com/';
// Tile schema major version understood by the pinned @protomaps/basemaps style
const SCHEMA = '4.';
// Max zoom of the Protomaps world build: the whole world at this zoom is the file itself
const ZOOM_SOURCE = 15;
export const FOND = 'fond';

// Last measured size of each pack, kept on disk so that it can be shown offline
const MESURES = path.join(DOSSIER, 'tailles.json');

const etat = globalThis.__odinCartes ??= {
  build: null, t: 0, tailles: new Map(), taches: new Map(), controles: new Map(), mesures: null
};

async function mesures() {
  etat.mesures ??= JSON.parse(await fs.readFile(MESURES, 'utf8').catch(() => '{}'));
  return etat.mesures;
}

async function memoriser(id, taille) {
  const m = await mesures();
  if (m[id] === taille) return;
  m[id] = taille;
  try {
    await fs.mkdir(DOSSIER, { recursive: true });
    await fs.writeFile(MESURES + '.tmp', JSON.stringify(m));
    await fs.rename(MESURES + '.tmp', MESURES);
  } catch {}
}

const direct = (p) => !p.zone && p.zoom >= ZOOM_SOURCE;
const fichier = (id) => path.join(DOSSIER, `${id}.pmtiles`);

export async function lirePacks() {
  const texte = await fs.readFile(CATALOGUE, 'utf8');
  return texte.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [id, zone, zoom, libelle] = l.split('|');
      return { id, zone: zone === '-' ? null : zone, zoom: Number(zoom), libelle };
    });
}

// Latest world build with a compatible schema. Its name is dated and changes daily,
// so it is always read from the index, never written in the code.
export async function dernierBuild() {
  if (Date.now() - etat.t < (etat.build ? 3600000 : 60000)) return etat.build;
  let build = null;
  try {
    const r = await fetch(INDEX, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      const [dernier] = (await r.json())
        .filter((b) => /^\d{8}\.pmtiles$/.test(b.key) && String(b.version).startsWith(SCHEMA))
        .sort((a, b) => b.key.localeCompare(a.key));
      if (dernier) build = { url: BUILDS + dernier.key, cle: dernier.key, taille: dernier.size };
    }
  } catch {}
  etat.build = build;
  etat.t = Date.now();
  return build;
}

const argsExtraction = (p, build, sortie) => [
  'extract', build.url, sortie, ...(p.zone ? [`--bbox=${p.zone}`] : []), `--maxzoom=${p.zoom}`
];

// Last meaningful line of pmtiles output, without the Go log prefix
const derniereLigne = (journal) => journal.split(/[\r\n]+/)
  .map((l) => l.replace(/^\S+ \S+ \S+\.go:\d+: /, '').trim())
  .filter(Boolean).at(-1) || '';

function pmtiles(args, { surSortie, signal, delai } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('pmtiles', args);
    let journal = '';
    const lire = (d) => {
      const s = d.toString();
      journal = (journal + s).slice(-4000);
      surSortie?.(s);
    };
    const arreter = () => p.kill('SIGTERM');
    const minuterie = delai && setTimeout(arreter, delai);
    signal?.addEventListener('abort', arreter, { once: true });
    p.stdout.on('data', lire);
    p.stderr.on('data', lire);
    p.on('error', reject);
    p.on('close', (code) => {
      clearTimeout(minuterie);
      signal?.removeEventListener('abort', arreter);
      if (code === 0) resolve(journal);
      else reject(new Error(derniereLigne(journal) || `pmtiles s'est arrêté (${code})`));
    });
  });
}

const UNITES = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };

// Size of a pack before download: a dry-run for extracts, the index for the whole file
export async function taille(id) {
  const pack = (await lirePacks()).find((p) => p.id === id);
  if (!pack) throw new Error('Pack inconnu');
  const build = await dernierBuild();
  if (!build) return null;
  if (direct(pack)) {
    await memoriser(id, build.taille);
    return build.taille;
  }

  const cle = `${build.cle}:${id}`;
  let entree = etat.tailles.get(cle);
  if (!entree) {
    const promesse = pmtiles([...argsExtraction(pack, build, '/dev/null'), '--dry-run'], { delai: 60000 })
      .then((journal) => {
        const m = journal.match(/archive size of ([\d.]+) ?([kKMGT]?B)/);
        if (!m) throw new Error('Taille illisible');
        entree.valeur = Math.round(parseFloat(m[1]) * UNITES[m[2]]);
        return memoriser(id, entree.valeur).then(() => entree.valeur);
      })
      .catch((e) => { etat.tailles.delete(cle); throw e; });
    entree = { promesse, valeur: null };
    etat.tailles.set(cle, entree);
  }
  return entree.promesse;
}

export async function listePacks() {
  const [packs, build, dernieres] = await Promise.all([lirePacks().catch(() => []), dernierBuild(), mesures()]);
  const fichiers = new Set(await fs.readdir(DOSSIER).catch(() => []));
  return {
    joignable: !!build,
    packs: await Promise.all(packs.map(async (p) => {
      const installe = fichiers.has(`${p.id}.pmtiles`);
      return {
        id: p.id,
        libelle: p.libelle,
        zoom: p.zoom,
        extraction: !direct(p),
        protege: p.id === FOND,
        installe,
        surDisque: installe ? (await fs.stat(fichier(p.id)).catch(() => null))?.size || 0 : 0,
        taille: build ? (direct(p) ? build.taille : etat.tailles.get(`${build.cle}:${p.id}`)?.valeur ?? null) : null,
        derniereMesure: dernieres[p.id] || null,
        tache: etat.taches.get(p.id) || null
      };
    }))
  };
}

export async function demarrer(id) {
  const courante = etat.taches.get(id);
  if (courante?.etat === 'en cours') return courante;

  const pack = (await lirePacks()).find((p) => p.id === id);
  if (!pack) throw new Error('Pack inconnu');
  const build = await dernierBuild();
  if (!build) throw new Error('Catalogue des cartes injoignable : une connexion internet est nécessaire.');
  const total = await taille(id);
  if (!total) throw new Error('Taille du pack inconnue, réessayez.');

  await fs.mkdir(DOSSIER, { recursive: true });
  const part = fichier(id) + '.part';
  const deja = direct(pack) ? (await fs.stat(part).catch(() => null))?.size || 0 : 0;
  const { bavail, bsize } = await fs.statfs(DOSSIER);
  const libre = bavail * bsize;
  // 5 % margin: dry-run sizes are rounded
  if (libre < (total - deja) * 1.05) {
    throw new Error(`Espace disque insuffisant : il faut ${octets(total - deja)}, il reste ${octets(libre)}.`);
  }

  const t = { etat: 'en cours', recu: deja, total, erreur: null, preparation: !direct(pack) };
  const c = new AbortController();
  etat.taches.set(id, t);
  etat.controles.set(id, c);

  // No inactivity timeout: an extract has a long silent preparation phase; cancelling is manual
  const travail = direct(pack)
    ? telechargerFlux(build.url, part, t, c, { inactivite: null })
    : pmtiles(argsExtraction(pack, build, part), {
      signal: c.signal,
      surSortie: (s) => {
        // Progress bar: "fetching chunks  42% |"
        const pct = [...s.matchAll(/(\d+)% \|/g)].at(-1);
        if (pct) {
          t.preparation = false;
          t.recu = Math.round((total * Number(pct[1])) / 100);
        }
      }
    });

  travail
    .then(async () => {
      await fs.rename(part, fichier(id));
      t.recu = t.total;
      t.etat = 'termine';
    })
    .catch(async (err) => {
      // An extract cannot resume, so its partial file is useless; a direct download keeps it
      if (c.signal.reason === 'annule' || !direct(pack)) await fs.rm(part, { force: true });
      if (c.signal.reason === 'annule') {
        t.etat = 'annule';
        return;
      }
      t.etat = 'erreur';
      t.erreur = err.message === 'fetch failed' ? 'Connexion impossible : internet est-il joignable ?' : err.message;
    })
    .finally(() => etat.controles.delete(id));
  return t;
}

export function annuler(id) {
  const c = etat.controles.get(id);
  if (!c) return false;
  c.abort('annule');
  return true;
}

export async function supprimer(id) {
  if (id === FOND) throw new Error('Le fond mondial ne se supprime pas : il garde la carte lisible partout.');
  if (etat.taches.get(id)?.etat === 'en cours') throw new Error('Téléchargement en cours : annulez-le d\'abord.');
  if (!(await lirePacks()).some((p) => p.id === id)) throw new Error('Pack inconnu');
  await fs.rm(fichier(id), { force: true });
  etat.taches.delete(id);
}

// Installed packs, for the map page. The version parameter defeats browser caches after a reinstall.
export async function installees() {
  const packs = await lirePacks().catch(() => []);
  const liste = await Promise.all(packs.map(async (p) => {
    const s = await fs.stat(fichier(p.id)).catch(() => null);
    return s && { id: p.id, url: `/tuiles/${p.id}.pmtiles?v=${Math.round(s.mtimeMs)}` };
  }));
  return liste.filter(Boolean);
}

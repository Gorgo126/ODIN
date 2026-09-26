import { promises as fs } from 'fs';
import { createHash, randomBytes } from 'crypto';
import path from 'path';
import { telechargerFlux } from './telechargements.mjs';
import { reserver, liberer, disquePlein } from './espace.mjs';
import { ecrireJson, lireJson } from './fichiers.mjs';
import { enLigne } from './liaison.mjs';
import { invaliderEspace } from './espace-cache.mjs';
import { lireTarGz } from './tar.mjs';
import { nettoyer, SLUG, FICHIER_ASSET } from './guides-html.mjs';
import { RACINE, ACTUEL, dossierActuel, lireIndex } from './guides-index.mjs';

// « Comment faire ? »: the articles of the odin-node.com blog, installed for offline reading. Nothing
// happens in the background: the manifest is read only when asked (« Vérifier les mises à jour »,
// « Installer », « Mettre à jour »). Contract: format 1 (see CLAUDE.md, « Comment faire ? »).

const MANIFESTE = process.env.GUIDES_MANIFESTE || 'https://odin-node.com/odin/guides/manifest.json';
const FORMAT = 1;
const DELAI_MANIFESTE = 10000;
const MAX_MANIFESTE = 2 * 1024 * 1024;
const MAX_ARCHIVE = 100 * 1024 * 1024;
const CONNEXION = 15000;
const PART = path.join(RACINE, '.archive.part');
export const SANS_INTERNET = 'Connexion à internet nécessaire pour installer ou mettre à jour';

const etat = globalThis.__odinGuides ??= { tache: null, travail: null, suppression: false };

const texte = (v) => typeof v === 'string' && v.trim() !== '';
const DATE = /^\d{4}-\d{2}-\d{2}/;

// Reason why a manifest is unusable, or null. publie: the published one, with « archive ».
export function defautManifeste(m, { publie = true } = {}) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'manifeste illisible';
  if (m.format !== FORMAT) return `format ${JSON.stringify(m.format)} non pris en charge (ODIN lit le format ${FORMAT}) : une mise à jour d'ODIN est nécessaire`;
  if (!texte(m.version) || m.version.length > 100) return 'version manquante';
  if (!texte(m.generated_at)) return 'date de génération manquante';
  if (!Array.isArray(m.categories) || !Array.isArray(m.articles)) return 'catégories ou articles manquants';
  const categories = new Set();
  for (const c of m.categories) {
    if (!c || !SLUG.test(String(c.slug)) || !texte(c.title) || typeof c.description !== 'string' || !Number.isFinite(c.order)) return `catégorie invalide : ${c?.slug ?? '?'}`;
    if (categories.has(c.slug)) return `catégorie en double : ${c.slug}`;
    categories.add(c.slug);
  }
  const articles = new Set();
  for (const a of m.articles) {
    if (!a || !SLUG.test(String(a.slug)) || a.slug.length > 150) return `article invalide : ${a?.slug ?? '?'}`;
    if (articles.has(a.slug)) return `article en double : ${a.slug}`;
    if (!texte(a.title) || typeof a.summary !== 'string') return `article sans titre : ${a.slug}`;
    if (!categories.has(a.category)) return `catégorie inconnue pour ${a.slug} : ${a.category}`;
    if (!DATE.test(String(a.published)) || !DATE.test(String(a.updated))) return `dates invalides : ${a.slug}`;
    if (!/^[0-9a-f]{64}$/.test(String(a.sha256))) return `empreinte invalide : ${a.slug}`;
    articles.add(a.slug);
  }
  if (!publie) return 'archive' in m ? 'le manifeste de l\'archive ne doit pas contenir « archive »' : null;
  const r = m.archive;
  if (!r || !/^[0-9a-f]{64}$/.test(String(r.sha256)) || !Number.isInteger(r.size) || r.size <= 0 || r.size > MAX_ARCHIVE) return 'archive mal décrite';
  let u;
  try { u = new URL(r.url); } catch { return 'adresse de l\'archive invalide'; }
  // Same site as the manifest: a manifest cannot send ODIN to download from elsewhere
  if (u.protocol !== 'https:' || u.origin !== new URL(MANIFESTE).origin) return 'archive hors du site des articles';
  return null;
}

// Differences between two manifests: the article sha256 only (contract)
export function comparer(local, distant) {
  const avant = new Map((local?.articles || []).map((a) => [a.slug, a]));
  const apres = new Map(distant.articles.map((a) => [a.slug, a]));
  const titre = (a) => ({ slug: a.slug, title: a.title });
  const nouveaux = distant.articles.filter((a) => !avant.has(a.slug)).map(titre);
  const modifies = distant.articles.filter((a) => avant.has(a.slug) && avant.get(a.slug).sha256 !== a.sha256).map(titre);
  const supprimes = [...avant.values()].filter((a) => !apres.has(a.slug)).map(titre);
  return { nouveaux, modifies, supprimes, aJour: !nouveaux.length && !modifies.length && !supprimes.length };
}

class ErreurReseau extends Error {}

// Published manifest, validated. Network trouble becomes an explicit message within seconds.
async function lireManifeste() {
  if (!(await enLigne())) throw new ErreurReseau(SANS_INTERNET);
  let r;
  try {
    r = await fetch(MANIFESTE, { cache: 'no-store', signal: AbortSignal.timeout(DELAI_MANIFESTE) });
  } catch (e) {
    console.error(`Comment faire ? : manifeste injoignable (${e.cause?.code || e.name || e.message})`);
    throw new ErreurReseau(`${SANS_INTERNET} : odin-node.com ne répond pas.`);
  }
  if (!r.ok) throw new Error(`manifeste des articles indisponible (erreur ${r.status})`);
  if (Number(r.headers.get('content-length')) > MAX_MANIFESTE) throw new Error('manifeste des articles trop gros');
  let m;
  try {
    const t = await r.text();
    if (t.length > MAX_MANIFESTE) throw new Error();
    m = JSON.parse(t);
  } catch {
    throw new Error('manifeste des articles illisible');
  }
  const d = defautManifeste(m);
  if (d) throw new Error(`manifeste des articles refusé : ${d}`);
  return m;
}

export const manifesteLocal = async () => {
  const dossier = await dossierActuel();
  return dossier ? lireJson(path.join(dossier, 'manifest.json'), null) : null;
};

// « Vérifier les mises à jour »: the manifest only, compared with the installed one
export async function verifier() {
  const [distant, local] = await Promise.all([lireManifeste(), manifesteLocal()]);
  return { version: distant.version, versionLocale: local?.version || null, ...comparer(local, distant) };
}

// Same content, whatever the key order
const canonique = (v) => (Array.isArray(v) ? `[${v.map(canonique).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonique(v[k])}`).join(',')}}`
  : JSON.stringify(v));

// Files of the archive checked against the manifest: allowed paths only (no traversal, no link),
// every article present, nothing else. Returns { interne, articles: Map slug → html, assets: Map }.
export function validerArchive(entrees, publie) {
  const slugs = new Set(publie.articles.map((a) => a.slug));
  const vus = new Set();
  const articles = new Map();
  const assets = new Map();
  let interne = null;
  for (const e of entrees) {
    const nom = e.nom.replace(/^\.\//, '');
    if (!nom || nom.startsWith('/') || nom.includes('\\') || nom.split('/').some((s) => s === '..' || s === '.')) {
      throw new Error(`chemin interdit dans l'archive : ${e.nom}`);
    }
    if (e.type === 'dossier') {
      const d = nom.replace(/\/$/, '');
      const m = d.match(/^assets\/([^/]+)$/);
      if (d === 'articles' || d === 'assets' || (m && slugs.has(m[1]))) continue;
      throw new Error(`dossier en trop dans l'archive : ${e.nom}`);
    }
    if (vus.has(nom)) throw new Error(`fichier en double dans l'archive : ${nom}`);
    vus.add(nom);
    let m;
    if (nom === 'manifest.json') {
      try { interne = JSON.parse(e.contenu.toString('utf8')); } catch { throw new Error('manifeste de l\'archive illisible'); }
    } else if ((m = nom.match(/^articles\/([^/]+)\.html$/)) && slugs.has(m[1])) {
      articles.set(m[1], e.contenu.toString('utf8'));
    } else if ((m = nom.match(/^assets\/([^/]+)\/([^/]+)$/)) && slugs.has(m[1]) && FICHIER_ASSET.test(m[2])) {
      assets.set(`${m[1]}/${m[2]}`, e.contenu);
    } else {
      throw new Error(`fichier en trop dans l'archive : ${nom}`);
    }
  }
  if (!interne) throw new Error('manifest.json absent de l\'archive');
  const d = defautManifeste(interne, { publie: false });
  if (d) throw new Error(`manifeste de l'archive refusé : ${d}`);
  const { archive: _archive, ...sansArchive } = publie;
  if (canonique(interne) !== canonique(sansArchive)) throw new Error('le manifeste de l\'archive ne correspond pas au manifeste publié');
  const manquants = [...slugs].filter((s) => !articles.has(s));
  if (manquants.length) throw new Error(`articles absents de l'archive : ${manquants.join(', ')}`);
  // Every image an article calls must be in the archive
  for (const [slug, html] of articles) {
    for (const [, src] of html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*["']?(?:\.\/)?(assets\/[^"'\s>]+)/gi)) {
      if (!assets.has(src.slice('assets/'.length))) throw new Error(`image absente de l'archive : ${src} (${slug})`);
    }
  }
  return { articles, assets };
}

// Optional « keywords » of an article (format 1): the article's own synonyms for the search. Kept
// only as a list of short strings; anything else is ignored (logged), never a reason to refuse.
export function motsCles(a) {
  if (a.keywords === undefined) return [];
  if (!Array.isArray(a.keywords)) {
    console.error(`Comment faire ? ${a.slug} : « keywords » ignoré (pas un tableau)`);
    return [];
  }
  const propres = a.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim().slice(0, 80));
  if (propres.length !== a.keywords.length) console.error(`Comment faire ? ${a.slug} : entrées de « keywords » ignorées (pas des chaînes)`);
  return [...new Set(propres)].slice(0, 30);
}

// Index of the version: what the pages and the search read, built once here
export function construireIndex(publie, { articles, assets }) {
  const categories = new Map(publie.articles.map((a) => [a.slug, a.category]));
  const cles = new Set(assets.keys());
  return {
    version: publie.version,
    generated_at: publie.generated_at,
    installe: new Date().toISOString(),
    categories: [...publie.categories].sort((a, b) => a.order - b.order),
    articles: publie.articles.map((a) => {
      const n = nettoyer(articles.get(a.slug), { slug: a.slug, articles: categories, assets: cles });
      if (n.rejetes.length) console.log(`Comment faire ? ${a.slug} : retiré au nettoyage : ${n.rejetes.join(', ')}`);
      return { ...a, keywords: motsCles(a), html: n.html, sections: n.sections };
    })
  };
}

async function empreinte(fichier) {
  return createHash('sha256').update(await fs.readFile(fichier)).digest('hex');
}

// Downloads and checks the archive of this manifest. Throws { raison: 'absente' | 'empreinte' } for
// the two cases where the site may have been redeployed meanwhile.
async function telechargerArchive(m, t) {
  await fs.rm(PART, { force: true });
  const c = new AbortController();
  t.etape = 'telechargement';
  t.recu = 0;
  t.total = m.archive.size;
  try {
    await telechargerFlux(m.archive.url, PART, t, c, { connexion: CONNEXION, maximum: m.archive.size });
  } catch (err) {
    await fs.rm(PART, { force: true });
    if (/\(404\)/.test(err.message)) throw Object.assign(new Error('archive introuvable (404)'), { raison: 'absente' });
    if (c.signal.reason === 'trop-gros') throw Object.assign(new Error('archive plus grosse que prévu'), { raison: 'empreinte' });
    if (disquePlein(err)) throw err;
    if (c.signal.reason === 'inactif' || c.signal.reason === 'connexion' || err.message === 'fetch failed') {
      console.error(`Comment faire ? : archive injoignable (${c.signal.reason || err.cause?.code || err.message})`);
      throw new ErreurReseau(`${SANS_INTERNET} : téléchargement interrompu.`);
    }
    throw err;
  }
  t.etape = 'verification';
  const recue = await empreinte(PART);
  if (recue !== m.archive.sha256) {
    await fs.rm(PART, { force: true });
    console.error(`Comment faire ? : empreinte de l'archive différente, attendue ${m.archive.sha256}, reçue ${recue}`);
    throw Object.assign(new Error('empreinte de l\'archive incorrecte'), { raison: 'empreinte' });
  }
  const donnees = await fs.readFile(PART);
  await fs.rm(PART, { force: true });
  return donnees;
}

// Writes the version in a folder of its own, then switches « actuel » to it in one rename: until
// then the installed version is untouched, and on any failure it stays as it was.
async function installerVersion(m, donnees, t) {
  t.etape = 'extraction';
  const contenu = validerArchive(lireTarGz(donnees), m);
  t.etape = 'indexation';
  const index = construireIndex(m, contenu);

  const nom = `v-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const tmp = path.join(RACINE, `.en-cours-${nom}`);
  await fs.mkdir(tmp, { recursive: true });
  try {
    await fs.mkdir(path.join(tmp, 'articles'));
    for (const [slug, html] of contenu.articles) await fs.writeFile(path.join(tmp, 'articles', `${slug}.html`), html);
    for (const [cle, octets] of contenu.assets) {
      await fs.mkdir(path.join(tmp, 'assets', path.dirname(cle)), { recursive: true });
      await fs.writeFile(path.join(tmp, 'assets', cle), octets);
    }
    await ecrireJson(path.join(tmp, 'manifest.json'), m, 1);
    await ecrireJson(path.join(tmp, 'guides.json'), index);
    await fs.rename(tmp, path.join(RACINE, nom));
  } catch (e) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw e;
  }
  const lien = path.join(RACINE, `.lien-${nom}`);
  await fs.symlink(nom, lien);
  await fs.rename(lien, ACTUEL);
  await nettoyerAnciennes();
}

// Folders of older versions and leftovers of an interrupted installation
async function nettoyerAnciennes() {
  const actuel = path.basename((await dossierActuel()) || '');
  for (const n of await fs.readdir(RACINE).catch(() => [])) {
    if (n === 'actuel' || n === actuel || n === path.basename(PART)) continue;
    if (/^(v-|\.en-cours-|\.lien-)/.test(n)) await fs.rm(path.join(RACINE, n), { recursive: true, force: true });
  }
}

async function installer(t) {
  let m = await lireManifeste();
  for (let essai = 1; ; essai++) {
    t.version = m.version;
    let donnees;
    try {
      donnees = await telechargerArchive(m, t);
    } catch (e) {
      // 404 or wrong hash: the site may have been redeployed between the manifest and the archive.
      // The manifest is read once more, and the archive it names tried once.
      if (!e.raison || essai >= 2) throw e;
      console.error(`Comment faire ? : ${e.message}, nouvelle lecture du manifeste`);
      t.etape = 'manifeste';
      m = await lireManifeste();
      continue;
    }
    await installerVersion(m, donnees, t);
    return m;
  }
}

export function tache() {
  return etat.tache;
}

// Installation and update are the same operation. One at a time; concurrent requests share it.
export function demarrer() {
  if (etat.travail) return etat.tache;
  if (etat.suppression) throw new Error('Suppression en cours');
  const t = { etat: 'en cours', etape: 'manifeste', recu: 0, total: 0, erreur: null, version: null };
  etat.tache = t;
  etat.travail = (async () => {
    await fs.mkdir(RACINE, { recursive: true });
    await reserver('guides', RACINE, 4 * 1024 * 1024);
    return installer(t);
  })()
    .then((m) => {
      t.etat = 'termine';
      t.recu = t.total;
      console.log(`Comment faire ? : version ${m.version} installée, ${m.articles.length} articles`);
    })
    .catch((e) => {
      t.etat = 'erreur';
      t.erreur = disquePlein(e) || (e instanceof ErreurReseau ? e.message : `Installation impossible : ${e.message}. Les articles déjà installés restent disponibles.`);
      console.error(`Comment faire ? : ${e.message}`);
    })
    .finally(async () => {
      await fs.rm(PART, { force: true }).catch(() => {});
      liberer('guides');
      etat.travail = null;
      invaliderEspace();
    });
  return t;
}

export async function supprimer() {
  if (etat.travail) throw new Error('Installation en cours : attendez qu\'elle se termine.');
  if (!(await dossierActuel())) throw new Error('Aucun article installé');
  etat.suppression = true;
  try {
    // The link first: the pages stop showing the articles at once
    await fs.rm(ACTUEL, { force: true });
    await fs.rm(RACINE, { recursive: true, force: true });
    etat.tache = null;
  } finally {
    etat.suppression = false;
    invaliderEspace();
  }
}

// Space used on the disk (blocks), links not followed
async function taille(chemin) {
  const s = await fs.lstat(chemin).catch(() => null);
  if (!s || s.isSymbolicLink()) return 0;
  let total = s.blocks ? s.blocks * 512 : s.size;
  if (s.isDirectory()) for (const n of await fs.readdir(chemin).catch(() => [])) total += await taille(path.join(chemin, n));
  return total;
}

export async function etatGuides() {
  const index = await lireIndex();
  return {
    installe: index ? {
      version: index.version,
      generated_at: index.generated_at,
      installeLe: index.installe,
      articles: index.articles.length,
      categories: index.categories.filter((c) => index.articles.some((a) => a.category === c.slug)).length,
      taille: await taille(await dossierActuel())
    } : null,
    tache: etat.tache
  };
}

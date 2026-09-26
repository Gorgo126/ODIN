import { promises as fs } from 'fs';
import path from 'path';
import { SLUG, FICHIER_ASSET } from './guides-html.mjs';

// Installed « Comment faire ? » articles, read side only (pages, search, the assistant's worker):
// no network, no dependency. The installation (lib/guides.mjs) writes each version in its own folder
// and switches the link « actuel » to it in one rename.
//
// /config/guides/actuel → v-<date>-<random>/
//   manifest.json   published manifest, complete (with « archive »)
//   guides.json     index built at installation: categories, articles with cleaned HTML and text
//   articles/<slug>.html, assets/<slug>/*   files of the archive, as verified

export const RACINE = '/config/guides';
export const ACTUEL = path.join(RACINE, 'actuel');

const cache = globalThis.__odinGuidesIndex ??= { dossier: null, mtime: 0, index: null };

// Folder of the installed version, or null
export async function dossierActuel() {
  try {
    return await fs.realpath(ACTUEL);
  } catch {
    return null;
  }
}

// Index of the installed version, or null when nothing is installed. Read again when the version
// changes (installation, update, removal), otherwise kept in memory.
export async function lireIndex() {
  const dossier = await dossierActuel();
  if (!dossier) {
    cache.dossier = null;
    cache.index = null;
    return null;
  }
  const fichier = path.join(dossier, 'guides.json');
  try {
    const { mtimeMs } = await fs.stat(fichier);
    if (cache.dossier !== dossier || cache.mtime !== mtimeMs) {
      const index = JSON.parse(await fs.readFile(fichier, 'utf8'));
      Object.assign(cache, { dossier, mtime: mtimeMs, index });
    }
    return cache.index;
  } catch {
    return null;
  }
}

export async function article(slug) {
  if (!SLUG.test(String(slug))) return null;
  return (await lireIndex())?.articles.find((a) => a.slug === slug) || null;
}

// Path of an asset of an installed article, or null. Strict: known article, file name of the
// contract, no link, and the resolved path stays in the article's assets folder.
export async function cheminAsset(slug, fichier) {
  if (!SLUG.test(String(slug)) || !FICHIER_ASSET.test(String(fichier))) return null;
  const dossier = await dossierActuel();
  const index = await lireIndex();
  if (!dossier || !index?.articles.some((a) => a.slug === slug)) return null;
  const base = path.join(dossier, 'assets', slug);
  const chemin = path.join(base, fichier);
  if (path.dirname(chemin) !== base) return null;
  const s = await fs.lstat(chemin).catch(() => null);
  return s?.isFile() ? chemin : null;
}

export const lienArticle = (a) => `/comment-faire/${a.category}/${a.slug}`;

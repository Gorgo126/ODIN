import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';

// Atomic JSON write. The temp name is unique: concurrent writers (parallel requests, separate
// bundles) would otherwise interleave in a shared temp file and corrupt it.
export async function ecrireJson(fichier, valeur, espaces) {
  await ecrireTexte(fichier, JSON.stringify(valeur, null, espaces));
}

export async function ecrireTexte(fichier, texte) {
  const tmp = `${fichier}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, texte);
    await fs.rename(tmp, fichier);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

// JSON read that tolerates a missing or damaged file
export async function lireJson(fichier, defaut) {
  try { return JSON.parse(await fs.readFile(fichier, 'utf8')); } catch { return defaut; }
}

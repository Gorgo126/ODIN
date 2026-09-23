import { promises as fs } from 'fs';
import { octets } from './format.mjs';

// Free space for downloads (packs, books, maps, AI model). Two downloads started together must not
// both count the same free space: each one reserves what it still has to write, on its disk (device
// of its folder), until it ends. A full disk during a download gives a clear message.

// id → { dev, reste() }: bytes still to be written by a download in progress
const reserves = globalThis.__odinEspace ??= new Map();

// Checks that `besoin` bytes fit next to the downloads in progress, then reserves them.
// reste(): what the download still has to write (the reservation shrinks as it goes).
export async function reserver(id, dossier, besoin, reste = () => besoin) {
  const [{ bavail, bsize }, { dev }] = await Promise.all([fs.statfs(dossier), fs.stat(dossier)]);
  let autres = 0;
  for (const [cle, r] of reserves) if (cle !== id && r.dev === dev) autres += Math.max(0, r.reste());
  const libre = bavail * bsize - autres;
  if (libre < besoin) {
    throw new Error(`Espace disque insuffisant : il faut ${octets(besoin)}, il reste ${octets(Math.max(0, libre))}${autres ? ' en comptant les téléchargements en cours' : ''}.`);
  }
  reserves.set(id, { dev, reste });
}

export const liberer = (id) => reserves.delete(id);

// Message for a write that failed because the disk is full, or null for any other error
export function disquePlein(err) {
  if (err?.code !== 'ENOSPC' && !/ENOSPC|no space left/i.test(String(err?.message))) return null;
  return 'Disque plein : le téléchargement s\'est arrêté. Libérez de la place (Stockage, sur l\'accueil), puis « Réessayer ».';
}

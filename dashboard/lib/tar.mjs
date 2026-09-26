import { gunzipSync } from 'zlib';

// Minimal reader of a gzipped ustar archive, entirely in memory: every entry is known and checked
// before anything is written to the disk. Only regular files and directories are accepted; links,
// devices and pax or GNU extensions are refused (an archive of articles never needs them).

const BLOC = 512;
const MAX_DECOMPRESSE = 64 * 1024 * 1024;

const champ = (b, debut, longueur) => {
  const s = b.subarray(debut, debut + longueur);
  const fin = s.indexOf(0);
  return s.subarray(0, fin === -1 ? s.length : fin).toString('utf8');
};
const octal = (b, debut, longueur) => {
  const s = champ(b, debut, longueur).trim();
  if (!/^[0-7]*$/.test(s)) throw new Error('en-tête tar illisible');
  return s ? parseInt(s, 8) : 0;
};

// Returns [{ nom, type: 'fichier' | 'dossier', contenu: Buffer }], in archive order
export function lireTarGz(donnees, max = MAX_DECOMPRESSE) {
  let tar;
  try {
    tar = gunzipSync(donnees, { maxOutputLength: max });
  } catch (e) {
    throw new Error(e.code === 'ERR_BUFFER_TOO_LARGE' ? 'archive trop grosse une fois décompressée' : 'archive gzip illisible');
  }
  const entrees = [];
  for (let i = 0; i + BLOC <= tar.length;) {
    const h = tar.subarray(i, i + BLOC);
    if (h.every((o) => o === 0)) break;
    // Checksum: sum of the header bytes, the checksum field counted as spaces
    let somme = 0;
    for (let k = 0; k < BLOC; k++) somme += k >= 148 && k < 156 ? 32 : h[k];
    if (somme !== octal(h, 148, 8)) throw new Error('somme de contrôle tar incorrecte');
    const type = String.fromCharCode(h[156] || 48);
    const taille = octal(h, 124, 12);
    const prefixe = champ(h, 345, 155);
    const nom = (prefixe ? `${prefixe}/` : '') + champ(h, 0, 100);
    const debut = i + BLOC;
    if (debut + taille > tar.length) throw new Error('archive tar tronquée');
    if (type === '0') entrees.push({ nom, type: 'fichier', contenu: tar.subarray(debut, debut + taille) });
    else if (type === '5') entrees.push({ nom, type: 'dossier', contenu: null });
    else throw new Error(`entrée tar non prise en charge (type ${type}) : ${nom}`);
    i = debut + Math.ceil(taille / BLOC) * BLOC;
  }
  return entrees;
}

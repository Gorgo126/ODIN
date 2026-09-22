import { inflateRawSync } from 'zlib';

// Minimal ZIP reader, enough for Office files (DOCX): finds an entry by name through the central
// directory and returns its bytes. Stored (0) and deflated (8) entries only; no ZIP64.
export function lireEntree(zip, nom) {
  const min = Math.max(0, zip.length - 65557);
  let fin = -1;
  for (let i = zip.length - 22; i >= min; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('archive ZIP illisible');
  const nombre = zip.readUInt16LE(fin + 10);
  let p = zip.readUInt32LE(fin + 16);
  for (let k = 0; k < nombre; k++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('archive ZIP illisible');
    const methode = zip.readUInt16LE(p + 10);
    const taille = zip.readUInt32LE(p + 20);
    const lnom = zip.readUInt16LE(p + 28);
    const lextra = zip.readUInt16LE(p + 30);
    const lcomm = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    if (zip.toString('utf8', p + 46, p + 46 + lnom) === nom) {
      const debut = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const donnees = zip.subarray(debut, debut + taille);
      if (methode === 0) return donnees;
      // Capped: a malformed or hostile file must not fill the memory
      if (methode === 8) return inflateRawSync(donnees, { maxOutputLength: 64 * 1024 * 1024 });
      throw new Error(`compression ZIP non prise en charge (${methode})`);
    }
    p += 46 + lnom + lextra + lcomm;
  }
  return null;
}

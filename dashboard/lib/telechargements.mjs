import { promises as fs, createWriteStream } from 'fs';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import path from 'path';
import { lirePacks, infos } from './catalogue.mjs';

const DATA = '/data';
const LIB = path.join(DATA, 'library.xml');
const VIDE = '<?xml version="1.0" encoding="UTF-8"?>\n<library version="20110515">\n</library>\n';
const taches = globalThis.__odinTaches ??= new Map();

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
  const e = await infos(pack);
  if (!e) throw new Error('Catalogue Kiwix injoignable ou pack introuvable');

  const t = { etat: 'en cours', recu: 0, total: e.taille, erreur: null };
  taches.set(id, t);
  telecharger(pack, e, t).catch((err) => { t.etat = 'erreur'; t.erreur = err.message; });
  return t;
}

async function telecharger(pack, e, t) {
  const fichier = nomFichier(e);
  const dest = path.join(DATA, fichier);
  const part = dest + '.part';

  if (!(await existe(dest))) {
    let deja = (await fs.stat(part).catch(() => null))?.size || 0;
    const { bavail, bsize } = await fs.statfs(DATA);
    if (bavail * bsize < e.taille - deja) throw new Error('Espace disque insuffisant');

    const r = await fetch(e.url.replace(/\.meta4$/, ''), {
      headers: deja ? { Range: `bytes=${deja}-` } : {}
    });
    if (r.status === 200) deja = 0;
    else if (r.status !== 206) throw new Error(`Téléchargement refusé (${r.status})`);
    t.recu = deja;

    const compteur = new Transform({ transform(c, _, cb) { t.recu += c.length; cb(null, c); } });
    await pipeline(Readable.fromWeb(r.body), compteur, createWriteStream(part, { flags: deja ? 'a' : 'w' }));
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

async function inscrire(e, fichier, debut) {
  let xml = await fs.readFile(LIB, 'utf8').catch(() => VIDE);
  xml = xml.replace(/\s*<book\b[^>]*\/>/g, (b) =>
    (b.match(/path="([^"]*)"/)?.[1] || '').startsWith(debut) ? '' : b);

  const livre = `  <book id="${esc(e.uuid)}" path="${esc(fichier)}" title="${esc(e.titre)}"`
    + ` description="${esc(e.description)}" language="${esc(e.langue)}" creator="${esc(e.createur)}"`
    + ` publisher="${esc(e.editeur)}" name="${esc(e.nom)}" flavour="${esc(e.variante)}"`
    + ` tags="${esc(e.tags)}" date="${esc(e.date)}" articleCount="${e.articles}"`
    + ` mediaCount="${e.medias}" size="${Math.round(e.taille / 1024)}" />`;

  xml = xml.replace('</library>', `${livre}\n</library>`);
  await fs.writeFile(LIB + '.tmp', xml);
  await fs.rename(LIB + '.tmp', LIB);
}

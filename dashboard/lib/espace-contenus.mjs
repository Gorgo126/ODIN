import { promises as fs } from 'fs';
import path from 'path';
import { etatEspace as etat } from './espace-cache.mjs';
import { espaceDisque } from './etat.mjs';
import { lirePacks } from './catalogue.mjs';
import { fichiersPack } from './telechargements.mjs';
import { lirePacks as lirePacksCartes, FOND } from './cartes.mjs';
import { fichiersLangues } from './traduction-packs.mjs';
import { modelesInstallesIA } from './ia.mjs';
import { lireJson } from './fichiers.mjs';
import { suppressionZim, suppressionLivre, suppressionCarte, suppressionLangue, suppressionModeleIA } from './suppressions.mjs';

// Space used by each kind of content, for /sante. Computed in the background, one computation at a
// time, never awaited by a request: the page shows the last result and « calcul en cours ». Kept
// 10 minutes, and computed again after every installation or removal (espace-cache.mjs).
const DUREE = 10 * 60 * 1000;

// Space on disk (blocks, as statfs counts it) of a file or a folder. Symbolic links are never
// followed: a link in Mes documents to / would otherwise count the whole disk.
async function taille(chemin) {
  const s = await fs.lstat(chemin).catch(() => null);
  if (!s || s.isSymbolicLink()) return 0;
  const octets = s.blocks ? s.blocks * 512 : s.size;
  if (!s.isDirectory()) return octets;
  let total = octets;
  for (const n of await fs.readdir(chemin).catch(() => [])) total += await taille(path.join(chemin, n));
  return total;
}

const lister = (dossier) => fs.readdir(dossier).catch(() => []);
const trier = (elements) => elements.sort((a, b) => b.taille - a.taille);

// Partial file of a download (running, or stopped and waiting for « Réessayer »)
const enCours = async (nom, chemin) => ({ id: `en-cours:${chemin}`, nom, taille: await taille(chemin), enCours: true, suppression: null });

async function zim() {
  const [packs, fichiers, xml] = await Promise.all([
    lirePacks().catch(() => []), lister('/data'), fs.readFile('/data/library.xml', 'utf8').catch(() => '')
  ]);
  const titres = new Map([...xml.matchAll(/<book\s([^>]*)\/>/g)].map((m) => [m[1].match(/path="([^"]*)"/)?.[1], m[1].match(/title="([^"]*)"/)?.[1]]));
  const pack = new Map();
  for (const p of packs) for (const f of await fichiersPack(p)) pack.set(f, p);
  const elements = [];
  for (const f of fichiers) {
    const chemin = path.join('/data', f);
    if (f.endsWith('.zim.part')) elements.push(await enCours(`${f.replace(/\.part$/, '')} (téléchargement)`, chemin));
    if (!f.endsWith('.zim')) continue;
    const p = pack.get(f);
    const t = await taille(chemin);
    // A ZIM added by hand, outside catalogue/packs.txt, has no uninstall in Configuration
    elements.push({ id: f, nom: titres.get(f) || f, taille: t, suppression: p ? suppressionZim({ id: p.id, libelle: p.libelle, taille: t }) : null });
  }
  return elements;
}

async function livres() {
  const elements = [];
  for (const n of await lister('/livres')) {
    const chemin = path.join('/livres', n);
    if (n === '.en-cours') {
      for (const f of await lister(chemin)) elements.push(await enCours(`${f.replace(/\.part$/, '')} (téléchargement)`, path.join(chemin, f)));
      continue;
    }
    const fiche = await lireJson(path.join(chemin, 'fiche.json'), null);
    if (fiche?.id !== n) continue;
    const t = await taille(chemin);
    elements.push({ id: n, nom: fiche.titre, taille: t, suppression: suppressionLivre({ id: n, titre: fiche.titre, taille: t }) });
  }
  return elements;
}

async function cartes() {
  const [packs, fichiers] = await Promise.all([lirePacksCartes().catch(() => []), lister('/cartes')]);
  const elements = [];
  for (const f of fichiers) {
    const chemin = path.join('/cartes', f);
    if (f.endsWith('.pmtiles.part')) elements.push(await enCours(`${f.replace(/\.pmtiles\.part$/, '')} (téléchargement)`, chemin));
    if (!f.endsWith('.pmtiles')) continue;
    const id = f.replace(/\.pmtiles$/, '');
    const p = packs.find((x) => x.id === id);
    const t = await taille(chemin);
    elements.push({ id, nom: p?.libelle || id, taille: t, suppression: p ? suppressionCarte({ id, libelle: p.libelle, taille: t, protege: id === FOND }) : null });
  }
  return elements;
}

async function langues() {
  const { langues: liste, enCours: travail } = await fichiersLangues();
  const elements = [];
  for (const l of liste) {
    let t = 0;
    for (const c of l.chemins) t += await taille(c);
    elements.push({ id: l.code, nom: l.nom, taille: t, suppression: suppressionLangue({ code: l.code, nom: l.nom, taille: t, base: l.base }) });
  }
  for (const code of await lister(travail)) elements.push(await enCours(`Langue ${code} (installation)`, path.join(travail, code)));
  return elements;
}

async function modelesIA() {
  return (await modelesInstallesIA()).map((m) => ({ id: m.id, nom: m.libelle, taille: m.taille, suppression: suppressionModeleIA(m) }));
}

async function calculer() {
  const debut = Date.now();
  const [disque, ...listes] = await Promise.all([
    espaceDisque(), zim(), livres(), cartes(), langues(),
    // Only with the AI option (OLLAMA_URL, compose.ia.yml)
    process.env.OLLAMA_URL ? modelesIA().catch(() => []) : null,
    taille('/documents')
  ]);
  const [z, l, c, t, ia, documents] = listes;
  const categories = [
    { id: 'zim', nom: 'Encyclopédie (packs ZIM)', lien: '/configuration', elements: trier(z) },
    { id: 'livres', nom: 'Bibliothèque (livres PDF)', lien: '/configuration', elements: trier(l) },
    { id: 'cartes', nom: 'Cartes', lien: '/configuration', elements: trier(c) },
    { id: 'traduction', nom: 'Langues de la traduction', lien: '/configuration#traduction', elements: trier(t) },
    ...(ia ? [{ id: 'ia', nom: 'Modèles de l\'assistant IA', lien: '/ia', elements: trier(ia) }] : []),
    { id: 'documents', nom: 'Mes documents', lien: '/documents/', elements: [{ id: 'documents', nom: 'Documents personnels', taille: documents, suppression: null }] }
  ].map((g) => ({ ...g, taille: g.elements.reduce((s, e) => s + e.taille, 0) }));
  // Everything else on the data disk: Docker images when on the same disk, the system, the search
  // index, the vectors model, the settings
  const connu = categories.reduce((s, g) => s + g.taille, 0);
  if (disque) categories.push({ id: 'autre', nom: 'Autre / système', elements: [], taille: Math.max(0, disque.utilise - connu) });
  return { disque, categories: categories.sort((a, b) => b.taille - a.taille), duree: Date.now() - debut };
}

function lancer() {
  etat.invalide = false;
  etat.calcul = calculer()
    .then((v) => { etat.resultat = { t: Date.now(), v }; })
    .catch((e) => console.error(`Espace par contenu : ${e.message}`))
    .finally(() => {
      etat.calcul = null;
      // Invalidated during the computation: one more, with the new state
      if (etat.invalide) lancer();
    });
}

// Last result at once; a new computation is started when needed, never awaited
export function espaceContenus() {
  if (!etat.calcul && (etat.invalide || !etat.resultat || Date.now() - etat.resultat.t > DUREE)) lancer();
  return { ...(etat.resultat?.v || { disque: null, categories: [] }), calcule: etat.resultat?.t ?? null, enCours: !!etat.calcul };
}

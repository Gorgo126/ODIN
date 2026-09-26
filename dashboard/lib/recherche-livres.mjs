import { promises as fs } from 'fs';
import path from 'path';
import { livresInstalles, dossierLivre } from './livres.mjs';
import { normaliser, normaliserAvecCarte, motsRequete, phraseRequete, positions } from './normalisation.mjs';
import { lireJson } from './fichiers.mjs';

// Full-text search in installed books, page by page. The normalized text of every page stays in
// memory (about 20 MB for a 640-page book) and is reloaded only when a book changes.
const index = globalThis.__odinIndexLivres ??= new Map();
const EXTRAIT = 260;

const echapper = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function charger() {
  const livres = await livresInstalles();
  const presents = new Set(livres.map((l) => l.id));
  for (const id of index.keys()) if (!presents.has(id)) index.delete(id);

  return (await Promise.all(livres.map(async (l) => {
    const fichier = path.join(dossierLivre(l.id), 'pages.json');
    const s = await fs.stat(fichier).catch(() => null);
    if (!s) { index.delete(l.id); return null; }
    const cle = `${l.verifie?.date}:${s.mtimeMs}`;
    let entree = index.get(l.id);
    if (entree?.cle !== cle) {
      const pages = await lireJson(fichier, []);
      entree = {
        cle,
        livre: { id: l.id, titre: l.titre, sante: l.avertissement === 'sante' },
        // One line of text per page, plus the hyphenated forms of words cut at a line end
        pages: pages.map((p) => ({
          page: p.page,
          chapitre: p.chapitre,
          texte: p.texte,
          norm: normaliser(`${p.texte} ${(p.coupes || []).join(' ')}`).replace(/\s+/g, ' '),
          chapNorm: p.chapitre ? normaliser(p.chapitre) : ''
        }))
      };
      index.set(l.id, entree);
    }
    return entree;
  }))).filter(Boolean);
}

// About EXTRAIT characters of the original text around the exact phrase, or else the first
// match, words in bold
export function extrait(texte, mots, phrase) {
  const plat = texte.replace(/\s+/g, ' ');
  const { n, carte } = normaliserAvecCarte(plat);
  const trouves = mots.flatMap((m) => positions(n, m).map((i) => [i, i + m.length])).sort((a, b) => a[0] - b[0]);
  const iPhrase = phrase ? n.indexOf(phrase) : -1;
  const premier = iPhrase >= 0 ? carte[iPhrase] : trouves.length ? carte[trouves[0][0]] : 0;

  let debut = Math.max(0, premier - 80);
  let fin = Math.min(plat.length, debut + EXTRAIT);
  if (debut > 0) debut = plat.indexOf(' ', debut) + 1 || debut;
  if (fin < plat.length) fin = plat.lastIndexOf(' ', fin) > debut ? plat.lastIndexOf(' ', fin) : fin;

  let html = '';
  let curseur = debut;
  for (const [a, b] of trouves) {
    const [o1, o2] = [carte[a], carte[b]];
    if (o1 < curseur || o2 > fin) continue;
    html += echapper(plat.slice(curseur, o1)) + '<b>' + echapper(plat.slice(o1, o2)) + '</b>';
    curseur = o2;
  }
  html += echapper(plat.slice(curseur, fin));
  return (debut > 0 ? '… ' : '') + html.trim() + (fin < plat.length ? ' …' : '');
}

// All words must be on the page (like Kiwix). Score: occurrences, bonus for the exact
// phrase and for words in the chapter title. Best pages first, then page order.
export async function chercherDansLivres(q, debut = 0, nombre = 20) {
  const mots = motsRequete(q);
  if (!mots.length) return { total: 0, resultats: [], mots };
  const livres = await charger();
  const phrase = phraseRequete(q);

  const trouves = [];
  for (const { livre, pages } of livres) {
    for (const p of pages) {
      let score = 0;
      for (const m of mots) {
        const k = positions(p.norm, m, 10).length;
        if (!k) { score = 0; break; }
        score += k;
      }
      if (!score) continue;
      if (phrase && p.norm.includes(phrase)) score += 15;
      for (const m of mots) if (p.chapNorm && positions(p.chapNorm, m, 1).length) score += 3;
      trouves.push({ livre, p, score });
    }
  }
  trouves.sort((a, b) => b.score - a.score || a.livre.titre.localeCompare(b.livre.titre) || a.p.page - b.p.page);

  return {
    total: trouves.length,
    mots,
    resultats: trouves.slice(debut, debut + nombre).map(({ livre, p }) => ({
      id: livre.id,
      titre: livre.titre,
      sante: livre.sante,
      page: p.page,
      chapitre: p.chapitre,
      extrait: extrait(p.texte, mots, phrase)
    }))
  };
}

// Number of indexed books: the search page only shows the books block when there is one
export async function livresIndexes() {
  return (await charger()).length;
}

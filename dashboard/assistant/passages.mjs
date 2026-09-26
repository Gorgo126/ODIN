import { motsRequete, normaliserAvecCarte, positions } from '../lib/normalisation.mjs';
import { CONSTANTES } from './constantes.mjs';
import { etiquette } from './prompt.mjs';
import { motsUtiles } from './contexte.mjs';

// Advanced search: the passages found by the index (personal documents, wikis, books), shown as
// they are, grouped by document, with their source and a link. Nothing is written, so nothing can
// be invented. No dependency on Next: shared by the route and the evaluation.

const SEUILS = { documents: 'documents', wiki: 'wikis', livre: 'livres', 'comment-faire': 'guides' };
const PASSAGES_PAR_DOCUMENT = 3;
const LONGUEUR = 420; // characters of a passage shown, around the first query word

// Where a source opens: personal PDFs in the viewer at the right page, other personal files as they
// are, wiki articles in ODIN's reader, books in their viewer (links built by the source)
export function lienDocument(chemin, page) {
  if (/\.pdf$/i.test(chemin)) return `/assistant/document?chemin=${encodeURIComponent(chemin)}${page ? `&page=${page}` : ''}`;
  return `/fichiers-documents/${chemin.split('/').map(encodeURIComponent).join('/')}`;
}
export const lien = (e) => e.lien || lienDocument(e.chemin, e.page);

// One key per document: a personal file, a wiki article, a book, a « Comment faire ? » article
export const cleSource = (e) => (e.origine === 'documents' ? e.chemin : e.origine === 'livre' ? `livre:${e.source}` : e.lien);

// With vectors: the thresholds of each source on the raw cosine. Without: the share of the query
// found in the passage (keywords only). « fort » answers the question, « proche » is near it.
function niveau(e, reglages, vecteurs) {
  if (vecteurs) {
    const s = reglages.seuils[SEUILS[e.origine] || 'documents'];
    // The title and section rules count here too: an article titled exactly by the term is about it
    const c = (e.cosinus ?? -1) + (e.ajustement || 0);
    return c >= s.reponse ? 'fort' : c >= s.proches ? 'proche' : null;
  }
  const c = e.couverture ?? 0;
  const s = reglages.couverture || CONSTANTES.couverture;
  return c >= s.forte ? 'fort' : c >= s.proches ? 'proche' : null;
}

// The part of a long passage around the first query word, cut at word boundaries
export function fenetre(texte, mots, max = LONGUEUR) {
  const t = texte.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const { n, carte } = normaliserAvecCarte(t);
  const premiere = Math.min(...mots.map((m) => positions(n, m, 1)[0] ?? Infinity));
  let debut = Number.isFinite(premiere) ? Math.max(0, carte[premiere] - Math.floor(max / 4)) : 0;
  if (debut > 0) debut = t.indexOf(' ', debut) + 1 || debut;
  if (debut + max > t.length) debut = Math.max(0, t.length - max);
  let fin = Math.min(t.length, debut + max);
  if (fin < t.length) fin = t.lastIndexOf(' ', fin) > debut ? t.lastIndexOf(' ', fin) : fin;
  return `${debut > 0 ? '… ' : ''}${t.slice(debut, fin)}${fin < t.length ? ' …' : ''}`;
}

// r: result of Index.rechercher. Returns the groups « fort » and « proche », best first.
// termes: search terms of the synonym table, highlighted too (« céphalée » for « mal de tête »)
export function grouper(r, question, reglages, { urgence = false, debug = false, termes = [] } = {}) {
  // Words to show and highlight: the meaningful ones (« comment », « je » are not)
  const utiles = [...motsUtiles(question), ...termes.flatMap((t) => motsUtiles(t))];
  const mots = utiles.length ? [...new Set(utiles)] : motsRequete(question);
  const groupes = new Map();
  const ecartes = [];
  for (const e of r.extraits) {
    const nv = niveau(e, reglages, r.vecteurs);
    if (!nv) {
      if (debug) ecartes.push({ origine: e.origine, titre: e.titre, section: e.section || '', page: e.page || null, cosinus: e.cosinus, couverture: e.couverture, bm25: e.bm25, regles: e.regles });
      continue;
    }
    const cle = cleSource(e);
    let g = groupes.get(cle);
    if (!g) {
      g = { cle, origine: e.origine, etiquette: etiquette(e), source: e.source, titre: e.titre, guide: e.guide === true, niveau: nv, lien: lien(e), passages: [] };
      groupes.set(cle, g);
    }
    if (g.passages.length >= PASSAGES_PAR_DOCUMENT) continue;
    g.passages.push({
      texte: fenetre(e.texte, mots),
      section: e.section || '',
      page: e.page || null,
      lien: lien(e),
      ...(debug ? { debug: { cosinus: e.cosinus, ajustement: e.ajustement, couverture: e.couverture, bm25: e.bm25, bm25Brut: e.bm25Brut, regles: e.regles, rrf: e.rrf, rangVecteur: e.rangVecteur, rangMots: e.rangMots } } : {})
    });
  }
  const tous = [...groupes.values()];
  // Emergency: a medical guide comes first in its level (the order is otherwise kept: best first)
  const ordre = (liste) => (urgence ? [...liste.filter((g) => g.guide), ...liste.filter((g) => !g.guide)] : liste);
  return {
    mots,
    forts: ordre(tous.filter((g) => g.niveau === 'fort')),
    proches: ordre(tous.filter((g) => g.niveau === 'proche')),
    // Debug: the passages below the thresholds, to see what the search found and why it was left out
    ...(debug ? { ecartes } : {})
  };
}

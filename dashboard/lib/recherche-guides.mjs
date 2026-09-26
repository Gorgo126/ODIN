import { normaliser, motsRequete, phraseRequete, positions } from './normalisation.mjs';
import { lireIndex, lienArticle } from './guides-index.mjs';
import { extrait } from './recherche-livres.mjs';
import { clesUtiles } from '../assistant/bm25.mjs';

// Keyword search in the « Comment faire ? » articles, section by section (the index built at
// installation: guides.json). Same rules as the books: every word in the section, occurrences, bonus
// for the exact phrase and for words in the article or section title. One result per article.
const memo = globalThis.__odinRechercheGuides ??= { index: null, sections: [] };

function sections(index) {
  if (memo.index !== index) {
    memo.index = index;
    memo.sections = index.articles.flatMap((a) => {
      // « keywords » of the manifest: synonyms of the whole article, as good as its title
      const cles = clesUtiles(a.keywords);
      return a.sections.map((s) => ({
        a,
        s,
        norm: normaliser(`${s.titre} ${s.texte}`).replace(/\s+/g, ' '),
        titres: `${normaliser(`${a.title} ${s.titre}`)} ${cles}`
      }));
    });
  }
  return memo.sections;
}

export async function chercherDansGuides(q, nombre = 5) {
  const mots = motsRequete(q);
  const index = await lireIndex();
  if (!mots.length || !index) return { total: 0, resultats: [] };
  const phrase = phraseRequete(q);
  const meilleurs = new Map();
  for (const x of sections(index)) {
    let score = 0;
    // Every word in the section, or among the article's keywords
    for (const m of mots) {
      const k = positions(x.norm, m, 10).length || positions(x.titres, m, 1).length;
      if (!k) { score = 0; break; }
      score += k;
    }
    if (!score) continue;
    if (phrase && x.norm.includes(phrase)) score += 15;
    for (const m of mots) if (positions(x.titres, m, 1).length) score += 5;
    if ((meilleurs.get(x.a.slug)?.score ?? -1) < score) meilleurs.set(x.a.slug, { ...x, score });
  }
  const tries = [...meilleurs.values()].sort((a, b) => b.score - a.score);
  return {
    total: tries.length,
    resultats: tries.slice(0, nombre).map(({ a, s }) => ({
      slug: a.slug,
      titre: a.title,
      section: s.titre,
      lien: lienArticle(a),
      extrait: extrait(s.texte, mots, phrase)
    }))
  };
}

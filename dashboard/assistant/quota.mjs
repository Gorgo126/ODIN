// Share of the places between packs in the wiki source (articles read, then paragraphs embedded).
// Generic: nothing depends on a given pack. No dependency (loaded by the worker).
//
// elements: in priority order, each with its pack, article and score (higher is better). The
// selection starts from the first n elements, as without any quota (at most parArticle per article,
// the other ones of the same article coming back only when there is nothing else). A pack holding
// more than parPack of these places is capped ONLY when another pack has a competing element: a
// score at least `seuil` (50 %) of the best score of the step. Its extra places then go to the next
// competing elements of the other packs, in order; when there are not enough of them, the pack keeps
// the rest of its places. So a purely medical question keeps its medical paragraphs: weak paragraphs
// of another pack never take them.
export const SEUIL_CONCURRENCE = 0.5;

export function repartir(elements, n, { parPack, parArticle = Infinity, seuil = SEUIL_CONCURRENCE, fixes = 0 } = {}) {
  const liste = elements.map((e, i) => ({ e, i }));
  const parArt = new Map();
  const base = [];
  const reserve = [];
  for (const x of liste) {
    if (base.length >= n) break;
    const k = (parArt.get(x.e.article) || 0) + 1;
    if (x.i >= fixes && k > parArticle) { reserve.push(x); continue; }
    parArt.set(x.e.article, k);
    base.push(x);
  }
  // Few articles: the paragraphs held back by the per-article limit come back, in order
  for (const x of reserve) if (base.length < n) base.push(x);

  const meilleur = Math.max(0, ...elements.map((e) => e.score || 0));
  const concurrent = (e) => meilleur > 0 && (e.score || 0) >= seuil * meilleur;
  const packsConcurrents = new Set(elements.filter(concurrent).map((e) => e.pack));
  const compte = (sel, pack) => sel.filter((x) => x.e.pack === pack).length;

  let selection = [...base];
  for (const pack of new Set(base.map((x) => x.e.pack))) {
    const exces = compte(selection, pack) - parPack;
    // Capped only when ANOTHER pack competes
    if (exces <= 0 || ![...packsConcurrents].some((p) => p !== pack)) continue;
    const pris = new Set(selection.map((x) => x.i));
    const art = new Map();
    for (const x of selection) art.set(x.e.article, (art.get(x.e.article) || 0) + 1);
    const remplacants = [];
    for (const x of liste) {
      if (remplacants.length >= exces) break;
      if (pris.has(x.i) || x.e.pack === pack || !concurrent(x.e)) continue;
      if ((art.get(x.e.article) || 0) >= parArticle) continue;
      art.set(x.e.article, (art.get(x.e.article) || 0) + 1);
      remplacants.push(x);
    }
    // The pack gives up its last places (never a fixed one), as many as there are replacements
    const siens = selection.filter((x) => x.e.pack === pack && x.i >= fixes).map((x) => x.i);
    remplacants.splice(siens.length);
    if (!remplacants.length) continue;
    const rendus = new Set(siens.slice(siens.length - remplacants.length));
    selection = [...selection.filter((x) => !rendus.has(x.i)), ...remplacants];
  }
  return selection.sort((a, b) => a.i - b.i).map((x) => x.e);
}

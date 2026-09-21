const KIWIX = 'http://kiwix:8080';
export const PAR_PAGE = 20;

const decoder = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const echapper = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const balise = (bloc, nom) => bloc.match(new RegExp(`<${nom}>([\\s\\S]*?)</${nom}>`))?.[1]?.trim() || '';

// Garde uniquement les mots en gras de Kiwix, échappe tout le reste
function extrait(brut) {
  let texte = decoder(brut);
  if (texte.length > 300) texte = texte.slice(0, 300).replace(/<\/?b?$/, '') + '';
  return echapper(texte).replace(/&lt;(\/?)b&gt;/g, '<$1b>');
}

export async function rechercher(q, debut = 0) {
  const params = new URLSearchParams({
    pattern: q, format: 'xml', start: String(debut), pageLength: String(PAR_PAGE)
  });
  const r = await fetch(`${KIWIX}/kiwix/search?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`La bibliothèque ne répond pas (${r.status}). Avez-vous installé du contenu ?`);
  const xml = await r.text();

  const vus = new Set();
  const resultats = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const lien = decoder(balise(item, 'link'));
    const base = lien.split('%23')[0];
    if (vus.has(base)) continue;
    vus.add(base);
    resultats.push({
      titre: decoder(balise(item, 'title')),
      lien: base,
      livre: decoder(balise(balise(item, 'book'), 'title')),
      extrait: extrait(balise(item, 'description'))
    });
  }

  return { total: parseInt(balise(xml, 'opensearch:totalResults') || '0', 10), resultats };
}

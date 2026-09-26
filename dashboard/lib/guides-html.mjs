// HTML of the « Comment faire ? » articles (odin-node.com), cleaned on the server at installation:
// a white list of tags and attributes, links to the blog turned into local links, images only from
// the article's own assets. Also gives the plain text of the article by section, for the search.
// No dependency: pure functions, tested by tests/guides.test.mjs.

// Tags of the contract, plus the parts a table needs to exist (thead, tbody, tfoot, tr, th, td).
// Attributes kept for each; every other attribute (on*, style, class, id…) is dropped.
const BALISES = {
  h2: [], h3: [], h4: [], p: [], ul: [], ol: ['start'], li: [], blockquote: [], pre: [], code: [],
  table: [], thead: [], tbody: [], tfoot: [], tr: [], th: ['colspan', 'rowspan', 'scope'], td: ['colspan', 'rowspan'],
  figure: [], figcaption: [], img: ['src', 'alt', 'width', 'height'], a: ['href', 'title'], strong: [], em: []
};
const VIDES = new Set(['img']);
// Removed with everything inside; any other unknown tag only loses its tags (its text stays)
const AVEC_CONTENU = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'title', 'textarea', 'select', 'head']);
// Block elements: a paragraph break in the plain text
const BLOCS = new Set(['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'tr', 'figure', 'figcaption']);
const VALEURS = {
  width: /^\d{1,4}$/, height: /^\d{1,4}$/, colspan: /^\d{1,3}$/, rowspan: /^\d{1,3}$/, start: /^\d{1,6}$/,
  scope: /^(row|col|rowgroup|colgroup)$/
};

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FICHIER_ASSET = /^[a-z0-9][a-z0-9._-]*\.(svg|png|jpe?g|webp|gif)$/i;
export const BLOG = 'https://odin-node.com/blog/';

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decoder(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITES[e.toLowerCase()] ?? m;
  });
}
export const echapper = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function attributs(brut) {
  const liste = [];
  for (const m of brut.matchAll(/([^\s=/"'>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g)) {
    const v = m[2] === undefined ? '' : m[2].replace(/^["']|["']$/g, '');
    liste.push([m[1].toLowerCase(), decoder(v)]);
  }
  return liste;
}

// Link of the article: local article, anchor, or external (http, https, mailto). null: dropped
// (javascript:, data:, anything else). ctx.articles: slug → category of the installed articles.
function lien(href, ctx) {
  // Control characters and spaces hide « java\tscript: » from a naive test
  const net = href.replace(/[\u0000- \u007f]/g, '');
  if (!net) return null;
  if (net.startsWith('#')) return { url: net };
  let u;
  try {
    u = new URL(net, BLOG);
  } catch {
    return null;
  }
  if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return null;
  if (/^(www\.)?odin-node\.com$/.test(u.hostname) && u.pathname.startsWith('/blog/')) {
    const slug = u.pathname.split('/').filter(Boolean).at(-1)?.replace(/\.html?$/, '');
    const categorie = slug && ctx.articles.get(slug);
    if (categorie) return { url: `/comment-faire/${categorie}/${slug}${u.hash}` };
  }
  return { url: u.href, externe: true };
}

// Image of the article: only one of its own assets, served by /api/guides/assets. null: dropped
function image(src, ctx) {
  const m = src.trim().replace(/^\.\//, '').match(/^assets\/([^/]+)\/([^/]+)$/);
  if (!m || m[1] !== ctx.slug || !FICHIER_ASSET.test(m[2]) || !ctx.assets.has(`${m[1]}/${m[2]}`)) return null;
  return `/api/guides/assets/${m[1]}/${m[2]}`;
}

// html: fragment of the archive. ctx: { slug, articles: Map slug → category, assets: Set « slug/file » }.
// Returns { html, sections: [{ titre, texte }], images: [asset url], rejetes: [what was dropped] }
export function nettoyer(html, ctx) {
  const sortie = [];
  const pile = [];
  const rejetes = [];
  const images = [];
  let ignorer = null; // tag whose content is being skipped
  let profondeur = 0;

  // Plain text by section, for the search
  const sections = [{ titre: '', texte: '' }];
  let titre = null; // text of the h2 being read
  const ajouterTexte = (t) => {
    if (titre !== null) titre += t;
    else sections.at(-1).texte += t;
  };
  const coupure = () => ajouterTexte('\n\n');

  for (const m of html.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!(?:[^>]*)>|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g)) {
    const jeton = m[0];
    const nom = m[1]?.toLowerCase();
    const fin = jeton.startsWith('</');

    if (ignorer) {
      if (nom === ignorer) profondeur += fin ? -1 : jeton.endsWith('/>') ? 0 : 1;
      if (profondeur === 0) ignorer = null;
      continue;
    }
    if (!nom) {
      if (jeton.startsWith('<!')) continue; // comments, doctype, CDATA
      // Text: kept as written (entities stay entities), a lone « < » escaped
      const texte = jeton === '<' ? '&lt;' : jeton.replace(/>/g, '&gt;');
      sortie.push(texte);
      ajouterTexte(decoder(jeton));
      continue;
    }
    if (AVEC_CONTENU.has(nom)) {
      rejetes.push(nom);
      if (!fin && !jeton.endsWith('/>')) { ignorer = nom; profondeur = 1; }
      continue;
    }
    const permis = BALISES[nom];
    if (!permis) {
      rejetes.push(nom);
      if (BLOCS.has(nom) || nom === 'br' || nom === 'div') coupure();
      continue;
    }
    if (fin) {
      if (VIDES.has(nom)) continue;
      const i = pile.lastIndexOf(nom);
      if (i === -1) continue; // stray end tag
      while (pile.length > i) {
        const b = pile.pop();
        sortie.push(`</${b}>`);
        if (b === 'h2' && titre !== null) { sections.push({ titre: titre.replace(/\s+/g, ' ').trim(), texte: '' }); titre = null; }
        if (BLOCS.has(b)) coupure();
      }
      continue;
    }

    // A block closes an open paragraph, as the HTML parser does: the stored HTML reads the same
    // everywhere, and the sections of the text follow the real structure
    if (BLOCS.has(nom) && pile.includes('p')) {
      while (pile.length) {
        const b = pile.pop();
        sortie.push(`</${b}>`);
        if (b === 'h2' && titre !== null) { sections.push({ titre: titre.replace(/\s+/g, ' ').trim(), texte: '' }); titre = null; }
        if (b === 'p') { coupure(); break; }
      }
    }
    let ouverture = `<${nom}`;
    let externe = false;
    let garder = true;
    for (const [a, v] of attributs(m[2] || '')) {
      if (!permis.includes(a)) { if (!a.startsWith('data-')) rejetes.push(`${nom}@${a}`); continue; }
      let valeur = v;
      if (VALEURS[a] && !VALEURS[a].test(v)) continue;
      if (nom === 'a' && a === 'href') {
        const l = lien(v, ctx);
        if (!l) { rejetes.push(`href ${v.slice(0, 40)}`); continue; }
        valeur = l.url;
        externe = !!l.externe;
      }
      if (nom === 'img' && a === 'src') {
        valeur = image(v, ctx);
        if (!valeur) { rejetes.push(`img ${v.slice(0, 60)}`); garder = false; break; }
        images.push(valeur);
      }
      ouverture += ` ${a}="${echapper(valeur)}"`;
    }
    if (nom === 'img' && (!garder || !ouverture.includes(' src="'))) continue;
    if (externe) ouverture += ' target="_blank" rel="noopener noreferrer" data-externe="1"';
    sortie.push(`${ouverture}>`);
    if (nom === 'img') continue;
    if (BLOCS.has(nom)) coupure();
    if (nom === 'h2') titre = '';
    if (nom === 'td' || nom === 'th') ajouterTexte(' ');
    pile.push(nom);
  }
  // Unclosed tags are closed: the fragment is inserted as is in the page
  while (pile.length) {
    const b = pile.pop();
    sortie.push(`</${b}>`);
    if (b === 'h2' && titre !== null) { sections.push({ titre: titre.replace(/\s+/g, ' ').trim(), texte: '' }); titre = null; }
  }
  return {
    html: sortie.join(''),
    sections: sections
      .map((s) => ({ titre: s.titre, texte: s.texte.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim() }))
      .filter((s) => s.titre || s.texte),
    images,
    rejetes: [...new Set(rejetes)]
  };
}

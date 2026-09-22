// « Wiki » source of the assistant: full-text search of kiwix-serve on every installed ZIM that
// has a full-text index (flag read in the LOCAL catalogue, never online), then the paragraphs of
// the first articles. Internal network only; every call has a delay.

const KIWIX = process.env.KIWIX_URL || 'http://kiwix:8080';
const DELAI = 5000;
const MIN_PARAGRAPHE = 60;
const MAX_PARAGRAPHES = 150; // per article: a very long article is cut, not read whole

const decoder = (s) => s
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      try { return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); } catch { return m; }
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e] ?? m;
  });
const texte = (html) => decoder(html.replace(/<sup\b[\s\S]*?<\/sup>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Installed books with a full-text index, from the local OPDS catalogue (kept one minute)
let catalogue = { quand: 0, livres: [] };
export async function livresIndexes() {
  if (Date.now() - catalogue.quand < 60000) return catalogue.livres;
  const r = await fetch(`${KIWIX}/kiwix/catalog/v2/entries?count=1000`, { signal: AbortSignal.timeout(DELAI) });
  if (!r.ok) throw new Error(`catalogue Kiwix : ${r.status}`);
  const xml = await r.text();
  const livres = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    id: e.match(/<id>urn:uuid:([^<]*)/)?.[1],
    titre: decoder(e.match(/<title>([^<]*)/)?.[1] || ''),
    index: /(^|;)_ftindex:yes(;|$)/.test(e.match(/<tags>([^<]*)/)?.[1] || ''),
    contenu: e.match(/type="text\/html" href="\/kiwix\/content\/([^"/]+)"/)?.[1]
  })).filter((l) => l.id && l.index && l.contenu);
  catalogue = { quand: Date.now(), livres };
  return livres;
}

async function chercher(q, livres, n) {
  const p = new URLSearchParams({ pattern: q, format: 'xml', pageLength: String(n) });
  livres.forEach((l) => p.append('books.id', l.id));
  const r = await fetch(`${KIWIX}/kiwix/search?${p}`, { signal: AbortSignal.timeout(DELAI) });
  if (!r.ok) throw new Error(`recherche Kiwix : ${r.status}`);
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => ({
    titre: decoder(item.match(/<title>([^<]*)/)?.[1] || ''),
    chemin: decoder(item.match(/<link>([^<]*)/)?.[1] || '').split('#')[0]
  })).filter((a) => a.chemin.startsWith('/kiwix/content/'));
}

// Paragraphs (and list items, definitions) with the heading they sit under
function paragraphes(html) {
  const corps = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const res = [];
  let section = '';
  for (const [, balise, contenu] of corps.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').matchAll(/<(h[1-4]|p|li|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = texte(contenu);
    if (/^h/i.test(balise)) section = t;
    else if (t.length >= MIN_PARAGRAPHE) res.push({ section, texte: t });
    if (res.length >= MAX_PARAGRAPHES) break;
  }
  return res;
}

// Both queries (full keywords and main term) in parallel, results interleaved without duplicates,
// then the paragraphs of the first `articles` articles
export async function passagesWikis(requetes, { articles = 15 } = {}) {
  const livres = await livresIndexes();
  if (!livres.length) return [];
  const listes = await Promise.all([...new Set(requetes.filter(Boolean))].map((q) => chercher(q, livres, articles).catch(() => [])));
  const vus = new Set();
  const retenus = [];
  for (let i = 0; retenus.length < articles && listes.some((l) => i < l.length); i++) {
    for (const l of listes) {
      const a = l[i];
      if (a && !vus.has(a.chemin) && retenus.length < articles) { vus.add(a.chemin); retenus.push(a); }
    }
  }
  const pack = (chemin) => livres.find((l) => chemin.startsWith(`/kiwix/content/${l.contenu}/`));
  const lus = await Promise.all(retenus.map(async (a) => {
    try {
      const r = await fetch(KIWIX + a.chemin, { signal: AbortSignal.timeout(DELAI) });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('text/html')) return [];
      const livre = pack(a.chemin);
      return paragraphes(await r.text()).map((p) => ({
        origine: 'wiki',
        source: livre?.titre || 'Wiki',
        titre: a.titre,
        section: p.section,
        texte: p.texte,
        // Opened in ODIN's own reader
        lien: `/lire/${a.chemin.slice('/kiwix/content/'.length)}`
      }));
    } catch {
      return [];
    }
  }));
  return lus.flat();
}

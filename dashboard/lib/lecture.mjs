import { promises as fs } from 'fs';

const KIWIX = 'http://kiwix:8080';

const decoder = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const attribut = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// Next.js peut déjà avoir décodé les segments : on normalise
const segment = (s) => {
  try { return encodeURIComponent(decodeURIComponent(s)); } catch { return encodeURIComponent(s); }
};

async function titreLivre(livre) {
  try {
    const xml = await fs.readFile('/data/library.xml', 'utf8');
    for (const [, attrs] of xml.matchAll(/<book\s([^>]*)\/>/g)) {
      if (attrs.match(/path="([^"]*)"/)?.[1] === `${livre}.zim`) {
        return decoder(attrs.match(/title="([^"]*)"/)?.[1] || livre);
      }
    }
  } catch {}
  return livre;
}

// Transforme une adresse relative de Kiwix en adresse utilisable depuis ODIN
function convertir(adresse, base, type) {
  if (adresse.startsWith('#')) return { url: adresse };
  let u;
  try { u = new URL(adresse, base); } catch { return { url: '#' }; }
  if (u.protocol === 'javascript:' || u.protocol === 'data:' && type === 'lien') return { url: '#' };
  if (u.origin !== KIWIX) return { url: u.href, externe: true };

  const m = u.pathname.match(/^\/kiwix\/content\/([^/]+)\/(.*)$/);
  if (m && type === 'lien' && !m[2].startsWith('_')) {
    return { url: `/lire/${m[1]}/${m[2]}${u.hash}` };
  }
  // Kiwix's own pages are not served (Caddyfile): its search becomes ODIN's, the rest the library page
  if (!m && type === 'lien') {
    const q = u.pathname === '/kiwix/search' ? u.searchParams.get('pattern') : null;
    return { url: q ? `/recherche?q=${encodeURIComponent(q)}` : '/encyclopedie' };
  }
  return { url: u.pathname + u.search + u.hash };
}

export async function lireArticle(livre, chemin) {
  const demande = `${KIWIX}/kiwix/content/${encodeURIComponent(livre)}/${chemin.map(segment).join('/')}`;
  let r;
  try {
    r = await fetch(demande, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  } catch {
    return { type: 'introuvable' };
  }
  if (!r.ok) return { type: 'introuvable' };

  // Après les éventuelles redirections, c'est l'adresse finale qui sert de base aux liens relatifs
  const base = r.url;
  const kiwix = new URL(base).pathname;
  if (!(r.headers.get('content-type') || '').includes('text/html')) return { type: 'fichier', url: kiwix };

  const brut = await r.text();
  const titre = decoder(brut.match(/<title>([^<]*)<\/title>/i)?.[1] || '');
  let html = brut.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? brut;

  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(<a\b[^>]*?\shref=")([^"]*)(")/gi, (_, debut, h, fin) => {
      const c = convertir(decoder(h), base, 'lien');
      return debut + attribut(c.url) + (c.externe ? '" target="_blank" rel="noopener noreferrer" data-externe="1' : '') + fin;
    })
    .replace(/(<(?:img|source)\b[^>]*?\ssrc=")([^"]*)(")/gi, (_, debut, s, fin) =>
      debut + attribut(convertir(decoder(s), base, 'ressource').url) + fin)
    .replace(/(\ssrcset=")([^"]*)(")/gi, (_, debut, liste, fin) => {
      const converti = decoder(liste).split(',').map((morceau) => {
        const [adresse, ...taille] = morceau.trim().split(/\s+/);
        return [convertir(adresse, base, 'ressource').url, ...taille].join(' ');
      }).join(', ');
      return debut + attribut(converti) + fin;
    });

  return { type: 'article', titre, html, kiwix, livreTitre: await titreLivre(livre) };
}

import { promises as fs } from 'fs';
import { installees } from './cartes.mjs';
import { livresInstalles } from './livres.mjs';
import { iaInstallee } from './assistant.mjs';

// Display order of the home cards (services not available are moved after the others, see page.jsx).
// Internal pages (interne) are available as soon as one pack of their kind is installed.
// The assistant is an option: without a model installed and enabled, its card leads to /ia
export const SERVICES = [
  { id: 'bibliotheque', nom: 'Encyclopédie', url: 'http://kiwix:8080/kiwix/', lien: '/kiwix/' },
  { id: 'livres', nom: 'Bibliothèque', lien: '/livres', interne: true },
  { id: 'carte', nom: 'Cartes', lien: '/carte', interne: true },
  { id: 'documents', nom: 'Documents personnels', url: 'http://filebrowser:80/documents/', lien: '/documents/' },
  { id: 'assistant', nom: 'Assistant IA', lien: '/assistant', interne: true }
];

const PRESENTS = { livres: livresInstalles, carte: installees, assistant: async () => (iaInstallee() ? [1] : []) };

export async function etatServices() {
  return Promise.all(SERVICES.map(async (s) => {
    if (s.interne) return { ...s, ok: s.toujours || (await PRESENTS[s.id]().catch(() => [])).length > 0 };
    try {
      const r = await fetch(s.url, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
      return { ...s, ok: r.ok || r.status === 302 };
    } catch {
      return { ...s, ok: false };
    }
  }));
}

export async function espaceDisque() {
  try {
    const s = await fs.statfs('/data');
    const total = s.blocks * s.bsize;
    const libre = s.bavail * s.bsize;
    return { total, libre, utilise: total - libre };
  } catch {
    return null;
  }
}

export async function contenu() {
  try {
    const xml = await fs.readFile('/data/library.xml', 'utf8');
    return [...xml.matchAll(/<book\s([^>]*)\/>/g)].map((m) => {
      const attr = (n) => (m[1].match(new RegExp(`${n}="([^"]*)"`)) || [])[1] || '';
      return {
        titre: attr('title'),
        description: attr('description'),
        langue: attr('language'),
        articles: parseInt(attr('articleCount') || '0', 10),
        taille: parseInt(attr('size') || '0', 10) * 1024
      };
    });
  } catch {
    return [];
  }
}

export function octets(n) {
  if (!n) return '';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

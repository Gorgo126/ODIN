import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { extrairePages } from '../lib/extraction.mjs';
import { lireEntree } from './zip.mjs';

// Text of a document as a list of blocks: { titre: true, texte } for a heading, { texte, page? }
// for a paragraph. Every format returns { type, titre, blocs }; an unsupported one throws
// FormatNonPrisEnCharge, logged and recorded without stopping the indexing.

export class FormatNonPrisEnCharge extends Error {}

export const EXTENSIONS = ['.pdf', '.md', '.markdown', '.txt', '.docx', '.html', '.htm'];
const TYPES = { '.markdown': 'md', '.htm': 'html' };

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', ndash: '–', mdash: '—', euro: '€', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euml: 'ë', oelig: 'œ', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç' };

function entites(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITES[e] ?? m;
  });
}

const espaces = (s) => s.replace(/[ \t\u00a0]+/g, ' ').trim();

// Plain text, UTF-8 or else Windows-1252 (older Windows files)
function decoder(octets) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(octets).replace(/^\uFEFF/, ''); }
  catch { return new TextDecoder('windows-1252').decode(octets); }
}

// A short line alone, without final punctuation, is taken as a heading (PDF and TXT have no markup)
const ressembleTitre = (p) => !p.includes('\n') && p.length <= 80 && /\p{L}/u.test(p) && !/[.,;:!?…)]$/.test(p) && /^[\p{Lu}\d]/u.test(p);

function paragraphes(texte, page) {
  const blocs = [];
  for (const brut of texte.split(/\n\s*\n/)) {
    const p = brut.trim();
    if (!p || /^\d+$/.test(p)) continue;
    if (ressembleTitre(p)) blocs.push({ titre: true, texte: espaces(p), page });
    else blocs.push({ texte: espaces(p.replace(/\n/g, ' ')), page });
  }
  return blocs;
}

function pdfinfo(fichier) {
  return new Promise((resolve) => {
    const p = spawn('pdfinfo', ['-enc', 'UTF-8', fichier]);
    let sortie = '';
    const minuterie = setTimeout(() => p.kill('SIGKILL'), 30000);
    p.stdout.on('data', (d) => { sortie += d; });
    p.on('error', () => { clearTimeout(minuterie); resolve(''); });
    p.on('close', () => { clearTimeout(minuterie); resolve((sortie.match(/^Title:\s*(.+)$/m) || [])[1]?.trim() || ''); });
  });
}

async function pdf(fichier) {
  const pages = await extrairePages(fichier);
  return {
    titre: await pdfinfo(fichier),
    pages: pages.length,
    blocs: pages.flatMap((p) => paragraphes(p.texte, p.page))
  };
}

function markdown(texte) {
  const blocs = [];
  let titre = '';
  // Fenced code blocks kept as plain paragraphs, markup removed from the rest
  for (const brut of texte.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    for (const ligne of brut.split('\n').filter((l) => /^#{1,6}\s/.test(l))) {
      const t = espaces(ligne.replace(/^#+\s*/, '').replace(/\s*#+\s*$/, ''));
      if (!titre && /^#\s/.test(ligne)) titre = t;
      blocs.push({ titre: true, texte: t });
    }
    const corps = brut.split('\n').filter((l) => !/^#{1,6}\s/.test(l)).join('\n')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '• ')
      .replace(/^\s*>\s?/gm, '')
      .replace(/[*_`~]{1,3}([^*_`~]+)[*_`~]{1,3}/g, '$1')
      .replace(/^```.*$/gm, '')
      .trim();
    if (corps) blocs.push({ texte: espaces(corps.replace(/\n/g, ' ')) });
  }
  return { titre, blocs };
}

function html(source) {
  const titre = espaces(entites((source.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/<[^>]+>/g, ''));
  const texte = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    // Headings kept as markers, block ends as paragraph breaks
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]\s*>/gi, (_, t) => `\n\n\u0001${t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}\n\n`)
    .replace(/<\/(p|div|li|tr|table|section|article|blockquote|pre|ul|ol|dd|dt|header|footer|main|aside|figcaption)\s*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<t[dh]\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const blocs = [];
  for (const brut of entites(texte).split(/\n\s*\n/)) {
    const p = espaces(brut.replace(/\n/g, ' '));
    if (!p) continue;
    if (p.startsWith('\u0001')) { const t = p.slice(1).trim(); if (t) blocs.push({ titre: true, texte: t }); }
    else blocs.push({ texte: p });
  }
  return { titre, blocs };
}

function docx(octets) {
  const xml = lireEntree(octets, 'word/document.xml');
  if (!xml) throw new Error('document Word illisible (word/document.xml absent)');
  const coeur = lireEntree(octets, 'docProps/core.xml')?.toString('utf8') || '';
  const titre = espaces(entites((coeur.match(/<dc:title>([\s\S]*?)<\/dc:title>/) || [])[1] || ''));
  const blocs = [];
  for (const [, p] of xml.toString('utf8').matchAll(/<w:p[ >]([\s\S]*?)<\/w:p>/g)) {
    const style = (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    // Text runs in order; tabs and line breaks become spaces
    const texte = espaces(entites([...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:(?:tab|br)\/>/g)].map((m) => m[1] ?? ' ').join('')));
    if (!texte) continue;
    blocs.push(/heading|titre|title/i.test(style) ? { titre: true, texte } : { texte });
  }
  return { titre, blocs };
}

export async function extraire(fichier) {
  const ext = path.extname(fichier).toLowerCase();
  if (!EXTENSIONS.includes(ext)) throw new FormatNonPrisEnCharge(`format non pris en charge (${ext || 'sans extension'})`);
  let r;
  if (ext === '.pdf') r = await pdf(fichier);
  else {
    const octets = await fs.readFile(fichier);
    if (ext === '.docx') r = docx(octets);
    else if (ext === '.html' || ext === '.htm') r = html(decoder(octets));
    else if (ext === '.txt') r = { titre: '', blocs: paragraphes(decoder(octets).replace(/\r\n?/g, '\n')) };
    else r = markdown(decoder(octets));
  }
  // A PDF title such as « Microsoft Word - devis.docx » is worse than the file name
  const titre = r.titre && !/^(microsoft|untitled|sans titre)|\.(docx?|pdf|odt)$/i.test(r.titre) ? r.titre : '';
  return { type: TYPES[ext] || ext.slice(1), titre: titre || nomLisible(fichier), blocs: r.blocs, pages: r.pages };
}

// « factures/2024_03-edf.pdf » → « 2024 03 edf »
export const nomLisible = (fichier) => path.basename(fichier, path.extname(fichier)).replace(/[_]+/g, ' ').trim();

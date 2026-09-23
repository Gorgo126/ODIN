import { spawn } from 'child_process';

// Text of a PDF, page by page, with pdftotext (poppler-utils in the dashboard image).
// Run as a child process: nothing of it stays in the server's memory.
const DELAI = 300000;

function pdftotext(pdf) {
  return new Promise((resolve, reject) => {
    const p = spawn('pdftotext', ['-enc', 'UTF-8', '-eol', 'unix', pdf, '-']);
    const morceaux = [];
    let erreur = '';
    const minuterie = setTimeout(() => p.kill('SIGKILL'), DELAI);
    p.stdout.on('data', (d) => morceaux.push(d));
    p.stderr.on('data', (d) => { erreur = (erreur + d).slice(-2000); });
    p.on('error', (e) => { clearTimeout(minuterie); reject(e); });
    p.on('close', (code, signal) => {
      clearTimeout(minuterie);
      if (code === 0) return resolve(Buffer.concat(morceaux).toString('utf8'));
      reject(new Error(signal ? `pdftotext arrêté (${signal})` : erreur.trim().split('\n').at(-1) || `pdftotext a échoué (${code})`));
    });
  });
}

// Running header of an even page: its own number alone on the first line, then the chapter
// (« 566 », « Chapitre 25 : Médicaments »). Returns the chapter, null for a numbered page outside
// any chapter (glossary, chapter opening), undefined when the page has no such header (odd pages
// keep the chapter of the page before).
function entete(texte, numero) {
  const [premiere, seconde = ''] = texte.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (premiere !== String(numero)) return undefined;
  return /^Chapitre ?\d+/i.test(seconde) ? seconde : null;
}

export function decouper(brut) {
  const pages = brut.split('\f');
  // pdftotext ends every page with a form feed, the last one included
  if (pages.length > 1 && !pages.at(-1).trim()) pages.pop();
  let chapitre = null;
  return pages.map((t, i) => {
    const titre = entete(t, i + 1);
    if (titre !== undefined) chapitre = titre;
    // A line ending with a hyphen is either a cut word (« rhu-matismes ») or a compound one
    // (« au-dessous »): the text keeps the joined form, the hyphenated one is kept for the search
    const coupes = [...t.matchAll(/(\p{L}+)-\n(\p{L}+)/gu)].map((m) => `${m[1]}-${m[2]}`);
    const texte = t
      .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2')
      // Dot leaders of the table of contents come out as unreadable characters
      .replace(/\uFFFD+/g, ' … ')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return coupes.length ? { page: i + 1, chapitre, texte, coupes } : { page: i + 1, chapitre, texte };
  });
}

export async function extrairePages(pdf) {
  return decouper(await pdftotext(pdf));
}

import { notFound } from 'next/navigation';
import { promises as fs } from 'fs';
import path from 'path';
import Visionneuse from '../../livres/[id]/Visionneuse';

export const dynamic = 'force-dynamic';

const RACINE = '/documents';

// A PDF of the personal documents, opened at the page an answer cites. The file itself is served
// by Caddy on /fichiers-documents/ (Range requests); this page only frames the pdf.js viewer.
export default async function Document({ searchParams }) {
  const { chemin, page } = await searchParams;
  const rel = typeof chemin === 'string' ? chemin : '';
  const abs = path.join(RACINE, rel);
  if (!rel || !/\.pdf$/i.test(rel) || !abs.startsWith(RACINE + '/')) notFound();
  if (!(await fs.stat(abs).then((s) => s.isFile(), () => false))) notFound();

  const n = Math.max(1, parseInt(page, 10) || 1);
  const fichier = `/fichiers-documents/${rel.split('/').map(encodeURIComponent).join('/')}`;
  const visionneuse = `/pdfjs/web/viewer.html?file=${encodeURIComponent(fichier)}#page=${n}`;
  const nom = path.basename(rel);

  return (
    <div className="cadre">
      <nav className="barre">
        <a href="/" className="accueil">ODIN</a>
        <span className="sep">/</span>
        <a href="/assistant">Assistant</a>
        <span className="sep">/</span>
        <span className="titre">{nom}</span>
      </nav>
      <Visionneuse src={visionneuse} titre={nom} page={n} recherche="" />
    </div>
  );
}

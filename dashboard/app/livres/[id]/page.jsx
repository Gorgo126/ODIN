import { notFound, redirect } from 'next/navigation';
import { livreInstalle, pageDemandee, urlFichier, AVERTISSEMENT_SANTE } from '../../../lib/livres.mjs';
import Visionneuse from './Visionneuse';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const livre = await livreInstalle((await params).id);
  return { title: livre ? `${livre.titre}  ODIN` : 'ODIN' };
}

// Reader: ODIN bar, health warning, then the pdf.js viewer (static files in public/pdfjs)
export default async function Lire({ params, searchParams }) {
  const { id } = await params;
  const { page, q } = await searchParams;
  const livre = await livreInstalle(id);
  if (!livre) notFound();

  const n = pageDemandee(page, livre.pages);
  const recherche = typeof q === 'string' ? q.trim().slice(0, 100) : '';
  // An unreadable or out-of-range page gives a clean URL showing the page actually opened
  if (page !== undefined && String(page) !== String(n)) {
    redirect(`/livres/${id}?page=${n}${recherche ? `&q=${encodeURIComponent(recherche)}` : ''}`);
  }

  const visionneuse = `/pdfjs/web/viewer.html?file=${encodeURIComponent(urlFichier(id))}#page=${n}`;

  return (
    <div className="cadre">
      <nav className="barre">
        <a href="/" className="accueil">ODIN</a>
        <span className="sep">/</span>
        <a href="/livres">Bibliothèque</a>
        <span className="sep">/</span>
        <span className="titre">{livre.titre}</span>
        <a className="externe" href={`/livres#${id}`} title="Auteurs, licence et attribution">Fiche du livre</a>
      </nav>
      {livre.avertissement === 'sante' && <p className="bandeau-sante bandeau-lecture">{AVERTISSEMENT_SANTE}</p>}
      <Visionneuse src={visionneuse} titre={livre.titre} page={n} recherche={recherche} />
    </div>
  );
}

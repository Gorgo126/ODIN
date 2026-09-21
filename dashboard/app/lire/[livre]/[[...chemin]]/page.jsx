import { notFound, redirect } from 'next/navigation';
import { lireArticle } from '../../../../lib/lecture.mjs';
import Lecteur from './Lecteur';

export const dynamic = 'force-dynamic';

export default async function Lire({ params }) {
  const { livre, chemin = [] } = await params;
  const a = await lireArticle(livre, chemin);
  if (a.type === 'introuvable') notFound();
  if (a.type === 'fichier') redirect(a.url);
  return (
    <Lecteur
      livre={a.livreTitre}
      livreLien={`/lire/${livre}`}
      titre={a.titre}
      html={a.html}
      kiwix={a.kiwix}
    />
  );
}

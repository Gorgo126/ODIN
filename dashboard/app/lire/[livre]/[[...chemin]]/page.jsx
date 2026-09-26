import { notFound, redirect } from 'next/navigation';
import { lireArticle } from '../../../../lib/lecture.mjs';
import Lecteur from './Lecteur';
import { liaison } from '../../../../lib/liaison.mjs';
import { licenceZim } from '../../../../lib/licences.mjs';

export const dynamic = 'force-dynamic';

export default async function Lire({ params }) {
  const { livre, chemin = [] } = await params;
  const [a, etatLiaison] = await Promise.all([lireArticle(livre, chemin), liaison()]);
  if (a.type === 'introuvable') notFound();
  if (a.type === 'fichier') redirect(a.url);
  return (
    <Lecteur
      livre={a.livreTitre}
      livreLien={`/lire/${livre}`}
      titre={a.titre}
      html={a.html}
      licence={licenceZim(livre)}
      liaisonInitiale={etatLiaison}
    />
  );
}

import { notFound, redirect } from 'next/navigation';
import { SERVICES } from '../../../lib/etat.mjs';
import Cadre from './Cadre';

export default async function Ouvrir({ params, searchParams }) {
  const { service } = await params;
  // Former Kiwix frame (bookmarks, old links): its articles now open in the reader
  if (service === 'bibliotheque') {
    const chemin = (await searchParams).chemin || '';
    const m = chemin.match(/^\/kiwix\/content\/([^?#]+)/);
    redirect(m ? `/lire/${m[1]}` : '/encyclopedie');
  }
  const s = SERVICES.find((x) => x.id === service);
  if (!s) notFound();
  return <Cadre nom={s.nom} lien={s.lien} />;
}

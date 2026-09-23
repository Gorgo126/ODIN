import { notFound } from 'next/navigation';
import { SERVICES } from '../../../lib/etat.mjs';
import Cadre from './Cadre';

export default async function Ouvrir({ params }) {
  const { service } = await params;
  const s = SERVICES.find((x) => x.id === service);
  if (!s) notFound();
  return <Cadre nom={s.nom} lien={s.lien} />;
}

import { installees } from '../../lib/cartes.mjs';
import { liaison } from '../../lib/liaison.mjs';
import Plan from './Plan';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cartes — ODIN' };

export default async function Carte() {
  const [packs, etatLiaison] = await Promise.all([installees(), liaison()]);
  return <Plan packs={packs} liaisonInitiale={etatLiaison} />;
}

import { installees } from '../../lib/cartes.mjs';
import Plan from './Plan';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Carte  ODIN' };

export default async function Carte() {
  return <Plan packs={await installees()} />;
}

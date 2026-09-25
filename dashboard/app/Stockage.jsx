import { espaceDisque } from '../lib/etat.mjs';
import JaugeDisque from './JaugeDisque';

export default async function Stockage() {
  return <JaugeDisque disque={await espaceDisque()} />;
}

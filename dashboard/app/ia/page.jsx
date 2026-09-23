import { etat } from '../../lib/ia.mjs';
import { liaison } from '../../lib/liaison.mjs';
import InstallationIA from './InstallationIA';

export const dynamic = 'force-dynamic';

// « Assistant IA » page: the hardware found by the installer, the models this card can run (the
// others greyed, with the reason), and their download, test and removal.
export default async function PageIA() {
  const [initial, etatLiaison] = await Promise.all([etat(), liaison()]);
  return (
    <main>
      <h1><a href="/" className="retour-accueil">ODIN</a></h1>
      <h2>Assistant IA</h2>
      <p className="ia-intro">
        La recherche avancée d'ODIN trouve les meilleurs passages sans modèle de langage. L'assistant IA, en
        option, rédige une réponse à partir de ces passages. Il demande une carte graphique NVIDIA ou AMD
        d'au moins 8 Go de mémoire.
      </p>
      <InstallationIA initial={initial} liaisonInitiale={etatLiaison} />
    </main>
  );
}

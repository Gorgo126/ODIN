import { etatSante } from '../../lib/sante.mjs';
import { espaceContenus } from '../../lib/espace-contenus.mjs';
import Sante from './Sante';
import EspaceContenus from './EspaceContenus';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'État du serveur — ODIN' };

export default async function PageSante() {
  const initiale = await etatSante();

  return (
    <main>
      <header className="entete">
        <a href="/" className="retour-accueil"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
        <nav className="entete-liens">
          <a href="/" className="bouton">Accueil</a>
          <a href="/configuration" className="bouton">Configuration</a>
        </nav>
      </header>

      <h1 className="titre-page">État du serveur</h1>
      <Sante initiale={initiale} />
      <EspaceContenus initial={espaceContenus()} />
    </main>
  );
}

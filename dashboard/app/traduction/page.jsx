import { langues, LIMITE, INJOIGNABLE } from '../../lib/traduction.mjs';
import Traducteur from './Traducteur';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Traduction — ODIN' };

export default async function Traduction() {
  // Languages read on the server: the page opens ready, or with the error at once
  const initiales = await langues(3000).catch(() => null);

  return (
    <main>
      <header className="entete">
        <a href="/" className="retour-accueil"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
        <nav className="entete-liens">
          <a href="/" className="bouton">Accueil</a>
          <a href="/configuration" className="bouton">Configuration</a>
        </nav>
      </header>

      <h1 className="titre-page">Traduction</h1>
      <Traducteur initiales={initiales} erreurInitiale={initiales ? null : INJOIGNABLE} limite={LIMITE} />
    </main>
  );
}

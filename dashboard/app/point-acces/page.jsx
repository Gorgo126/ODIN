import { lirePointAcces } from '../../lib/point-acces.mjs';
import PointAcces from './PointAcces';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Point d\'accès Wi-Fi — ODIN' };

// Wi-Fi access point: what it does, what happens to this machine's connection, the information to note,
// then the switch. The host does the work (scripts/point-acces.sh); this page only sends a request.
export default async function Page() {
  const etat = await lirePointAcces();
  return (
    <main className="point-acces">
      <header className="entete">
        <a href="/" className="retour-accueil"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
        <nav className="entete-liens">
          <a href="/configuration" className="bouton">Configuration</a>
        </nav>
      </header>
      <h1 className="titre-page">Point d'accès Wi-Fi</h1>
      <PointAcces initial={etat} />
    </main>
  );
}

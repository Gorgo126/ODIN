import { etatPointAcces } from '../../../lib/portail.mjs';
import Imprimer from './Imprimer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fiche du réseau Wi-Fi — ODIN' };

// Printable sheet to put next to the machine: join the network, then open ODIN (behind the login)
export default async function Fiche() {
  const e = await etatPointAcces();
  const pret = e?.motDePasse && e?.adresse;

  return (
    <main className="fiche-wifi">
      <header className="entete">
        <a href="/" className="retour-accueil"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
        <nav className="entete-liens">
          <a href="/point-acces" className="bouton">Point d'accès Wi-Fi</a>
          {pret && <Imprimer />}
        </nav>
      </header>
      {!pret ? (
        <p>Le point d'accès Wi-Fi n'est pas installé.</p>
      ) : (
        <>
          <h1 className="titre-page">Réseau Wi-Fi d'ODIN</h1>
          <div className="fiche-wifi-grille">
            <section className="carte">
              <h2>1. Rejoindre le réseau</h2>
              <img src="/api/point-acces/qr/wifi" alt="QR code du réseau Wi-Fi" className="fiche-qr" />
              <p>Réseau : <strong>{e.ssid}</strong></p>
              <p>Mot de passe : <strong className="fiche-mdp">{e.motDePasse}</strong></p>
            </section>
            <section className="carte">
              <h2>2. Ouvrir ODIN</h2>
              <img src="/api/point-acces/qr/adresse" alt="QR code de l'adresse d'ODIN" className="fiche-qr" />
              <p>Adresse : <strong>http://{e.adresse}</strong></p>
              {e.noms?.[0] && <p>ou <strong>http://{e.noms[0]}</strong></p>}
            </section>
          </div>
          <p className="fiche-note">Sur Android, si le téléphone signale une connexion limitée, choisissez « Utiliser ce réseau » ou coupez les données mobiles.</p>
        </>
      )}
    </main>
  );
}

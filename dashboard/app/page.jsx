import { etatServices } from '../lib/etat.mjs';
import BarreRecherche from './BarreRecherche';
import Stockage from './Stockage';

export const dynamic = 'force-dynamic';

const DESCRIPTIONS = {
  bibliotheque: "Encyclopédies et ouvrages de référence au format ZIM, indexés en plein texte et consultables hors ligne.",
  documents: "Stockage de fichiers personnels sur le serveur, accessible depuis tout navigateur du réseau local.",
  ia: "Modèle de langage exécuté localement, capable d'exploiter vos documents indexés. Aucune donnée ne quitte le serveur."
};

const trait = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

const ICONES = {
  bibliotheque: (
    <svg viewBox="0 0 24 24" {...trait}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  ),
  documents: (
    <svg viewBox="0 0 24 24" {...trait}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  ),
  ia: (
    <svg viewBox="0 0 24 24" {...trait}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  )
};

export default async function Page() {
  const services = await etatServices();

  return (
    <main>
      <header className="entete">
        <h1><img src="/logo.png" alt="ODIN" className="logo" /></h1>
        <nav className="entete-liens">
          <a href="/configuration" className="bouton">Configuration</a>
          <a href="/api/auth/deconnexion" className="bouton">Se déconnecter</a>
        </nav>
      </header>

      <BarreRecherche />

      <section>
        <h2>Services</h2>
        <div className="services">
          {services.map((s) => (
            <a key={s.id} href={'/ouvrir/' + s.id} className="service">
              <div className="service-tete">
                <span className="service-icone">{ICONES[s.id]}</span>
                <span className={s.ok ? 'etat en-ligne' : 'etat arrete'}>{s.ok ? 'Online' : 'Offline'}</span>
              </div>
              <strong>{s.nom}</strong>
              <p>{DESCRIPTIONS[s.id]}</p>
            </a>
          ))}
        </div>
      </section>

      <section>
        <h2>Stockage</h2>
        <Stockage />
      </section>
    </main>
  );
}

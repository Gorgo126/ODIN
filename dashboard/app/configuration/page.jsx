import { contenu, octets } from '../../lib/etat.mjs';
import Stockage from '../Stockage';
import Packs from '../Packs';
import Panneau from '../Panneau';

export const dynamic = 'force-dynamic';

const trait = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

const iconeLivre = (
  <svg viewBox="0 0 24 24" {...trait}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

export default async function Configuration() {
  const livres = await contenu();
  const resume = `${livres.length} contenu${livres.length > 1 ? 's' : ''} installé${livres.length > 1 ? 's' : ''}`;

  return (
    <main>
      <header className="entete">
        <a href="/" className="retour-accueil"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
        <nav className="entete-liens">
          <a href="/" className="bouton"> Accueil</a>
          <a href="/api/auth/deconnexion" className="bouton">Se déconnecter</a>
        </nav>
      </header>

      <h1 className="titre-page">Configuration</h1>

      <section>
        <h2>Stockage</h2>
        <Stockage />
      </section>

      <Panneau
        icone={iconeLivre}
        titre="Bibliothèque"
        sousTitre="Encyclopédies et ouvrages de référence au format ZIM"
        resume={resume}
      >
        <h3>Contenu installé ({livres.length})</h3>
        {livres.length === 0 && <p className="vide">Aucun contenu.</p>}
        <div className="grille">
          {livres.map((l, i) => (
            <div key={i} className="carte">
              <strong>{l.titre}</strong>
              <p>{l.description}</p>
              <em>{l.articles.toLocaleString('fr-BE')} articles  {octets(l.taille)}</em>
            </div>
          ))}
        </div>

        <h3>Ajouter du contenu</h3>
        <div className="grille">
          <Packs />
        </div>
      </Panneau>
    </main>
  );
}

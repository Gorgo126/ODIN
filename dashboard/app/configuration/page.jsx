import { contenu, octets } from '../../lib/etat.mjs';
import Stockage from '../Stockage';
import Packs from '../Packs';
import PacksCartes from '../PacksCartes';
import { installees } from '../../lib/cartes.mjs';
import Panneau from '../Panneau';

export const dynamic = 'force-dynamic';

const trait = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

const iconeLivre = (
  <svg viewBox="0 0 24 24" {...trait}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

const iconeCarte = (
  <svg viewBox="0 0 24 24" {...trait}>
    <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4z" />
    <path d="M8 2v16" />
    <path d="M16 6v16" />
  </svg>
);

const pluriel = (n, mot, e = '') => `${n} ${mot}${n > 1 ? 's' : ''} installé${e}${n > 1 ? 's' : ''}`;

export default async function Configuration() {
  const [livres, cartes] = await Promise.all([contenu(), installees()]);
  const resume = pluriel(livres.length, 'contenu');

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

      <Panneau
        icone={iconeCarte}
        titre="Cartes"
        sousTitre="Cartes OpenStreetMap hors ligne, par région"
        resume={pluriel(cartes.length, 'carte', 'e')}
      >
        <div className="grille">
          <PacksCartes />
        </div>
      </Panneau>
    </main>
  );
}

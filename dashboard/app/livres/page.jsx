import { livresInstalles, AVERTISSEMENT_SANTE } from '../../lib/livres.mjs';
import { liaison } from '../../lib/liaison.mjs';
import { octets } from '../../lib/format.mjs';
import LienExterne from '../LienExterne';

export const dynamic = 'force-dynamic';

const CATEGORIES = { sante: 'Santé', eau: 'Eau', energie: 'Énergie', agriculture: 'Agriculture', technique: 'Technique' };
const date = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

export default async function Livres() {
  const [livres, etatLiaison] = await Promise.all([livresInstalles(), liaison()]);

  return (
    <main>
      <header className="entete">
        <a href="/" className="retour-accueil"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
        <nav className="entete-liens">
          <a href="/" className="bouton">Accueil</a>
          <a href="/configuration" className="bouton">Configuration</a>
        </nav>
      </header>

      <h1 className="titre-page">Livres</h1>

      {livres.length === 0 && (
        <p className="vide">Aucun livre installé. Ajoutez-en depuis <a href="/configuration">Configuration</a>, section Livres.</p>
      )}

      {livres.map((l) => (
        <article key={l.id} id={l.id} className="fiche-livre">
          <div className="fiche-tete">
            <div>
              <span className="livre-badges">
                <span className="badge">Livre · PDF</span>
                {CATEGORIES[l.categorie] && <span className="badge badge-discret">{CATEGORIES[l.categorie]}</span>}
              </span>
              <h2>{l.titre}</h2>
              {l.sousTitre && <p className="fiche-sous-titre">{l.sousTitre}</p>}
            </div>
            <a href={`/livres/${l.id}`} className="bouton bouton-lire">Lire</a>
          </div>

          {l.avertissement === 'sante' && <p className="bandeau-sante">{AVERTISSEMENT_SANTE}</p>}

          <dl className="fiche-attribution">
            <dt>Auteurs</dt><dd>{l.auteurs.join(', ')}</dd>
            <dt>Éditeur</dt><dd>{l.editeur}</dd>
            {l.edition && <><dt>Édition</dt><dd>{l.edition}{l.isbn ? `  ISBN ${l.isbn}` : ''}</dd></>}
            <dt>Attribution</dt><dd>{l.attribution}</dd>
            {l.credit && <><dt>Crédit</dt><dd>{l.credit}</dd></>}
            <dt>Licence</dt><dd>{l.licence.nom}{l.licence.conditions ? `  ${l.licence.conditions}` : ''}</dd>
            <dt>Recherche</dt>
            <dd>{l.texte ? 'Texte extrait : le livre répond à la recherche d\'ODIN, page par page' : 'Texte pas encore extrait : le livre ne répond pas encore à la recherche'}</dd>
            <dt>Fichier</dt>
            <dd>
              {l.pages ? `${l.pages} pages  ` : ''}{octets(l.taille)}  non modifié, empreinte vérifiée
              {l.verifie && ` le ${date(l.verifie.date)} (${l.verifie.source === 'miroir' ? 'miroir ODIN' : 'source officielle'})`}
              <br /><code title="SHA-256">{l.sha256}</code>
            </dd>
          </dl>

          <div className="liaison-liens fiche-liens">
            <LienExterne href={l.licence.url} liaisonInitiale={etatLiaison}>Conditions de la licence</LienExterne>
            {l.site && <LienExterne href={l.site} liaisonInitiale={etatLiaison}>Site de l'éditeur</LienExterne>}
            {l.dons && <LienExterne href={l.dons} liaisonInitiale={etatLiaison}>Soutenir l'éditeur</LienExterne>}
          </div>
        </article>
      ))}
    </main>
  );
}

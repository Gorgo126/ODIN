import { contenu, octets } from '../../lib/etat.mjs';
import Stockage from '../Stockage';
import Packs from '../Packs';
import PacksCartes from '../PacksCartes';
import Livres from '../Livres';
import PacksTraduction from '../PacksTraduction';
import { languesInstallees } from '../../lib/traduction-packs.mjs';
import { listeLivres } from '../../lib/livres.mjs';
import { installees } from '../../lib/cartes.mjs';
import { liaison } from '../../lib/liaison.mjs';
import { lireReglages } from '../../lib/reglages.mjs';
import ReglagesLiaison from '../ReglagesLiaison';
import Panneau from '../Panneau';
import Assistant from './Assistant';
import { reglagesAssistant, demander } from '../../lib/assistant.mjs';
import { DEFAUTS } from '../../assistant/reglages.mjs';
import { etatPointAcces } from '../../lib/portail.mjs';
import { RAISONS, ETATS } from '../../lib/point-acces.mjs';
import { etatGuides } from '../../lib/guides.mjs';
import GestionGuides from '../comment-faire/Gestion';

export const dynamic = 'force-dynamic';

const trait = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

const iconeLivre = (
  <svg viewBox="0 0 24 24" {...trait}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

// Closed book with a bookmark: PDF books, distinct from the open book of the ZIM library
const iconeLivreFerme = (
  <svg viewBox="0 0 24 24" {...trait}>
    <path d="M4 19.5V4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" />
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M14 2v7l2-1.5L18 9V2" />
  </svg>
);

const iconeCarte = (
  <svg viewBox="0 0 24 24" {...trait}>
    <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4z" />
    <path d="M8 2v16" />
    <path d="M16 6v16" />
  </svg>
);

// Speech bubble: the assistant
const iconeAssistant = (
  <svg viewBox="0 0 24 24" {...trait}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M8 9h8" />
    <path d="M8 13h5" />
  </svg>
);

// Letters and sign: translation
const iconeTraduction = (
  <svg viewBox="0 0 24 24" {...trait}>
    <path d="M4 5h9" />
    <path d="M8.5 3v2" />
    <path d="M11 5c-1 4-4 7-7 8.5" />
    <path d="M6 8.5c1.2 2 3 3.6 5 4.5" />
    <path d="M12 21l4.5-10L21 21" />
    <path d="M13.6 17.5h5.8" />
  </svg>
);

const iconeLiaison = (
  <svg viewBox="0 0 24 24" {...trait}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20z" />
  </svg>
);

// Question mark in a circle: « Comment faire ? » articles
const iconeGuides = (
  <svg viewBox="0 0 24 24" {...trait}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
);

// Radio waves: Wi-Fi access point
const iconeWifi = (
  <svg viewBox="0 0 24 24" {...trait}>
    <path d="M2 8.5a15 15 0 0 1 20 0" />
    <path d="M5 12a10 10 0 0 1 14 0" />
    <path d="M8.5 15.5a5 5 0 0 1 7 0" />
    <path d="M12 19h.01" />
  </svg>
);

const pluriel = (n, mot, e = '') => `${n} ${mot}${n > 1 ? 's' : ''} installé${e}${n > 1 ? 's' : ''}`;

export default async function Configuration() {
  const [livres, cartes, etatLiaison, reglages, pdf, langues] = await Promise.all([contenu(), installees(), liaison(), lireReglages(), listeLivres(), languesInstallees().catch(() => [])]);
  const assistant = reglagesAssistant();
  const [wifi, guides] = await Promise.all([etatPointAcces(), etatGuides()]);
  // The index answers at once; a worker still starting must not hold the page
  const etatIndex = await demander('etat', {}, 3000).catch(() => null);
  const resume = pluriel(livres.length, 'contenu');

  return (
    <main>
      <header className="entete">
        <a href="/" className="retour-accueil"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
        <nav className="entete-liens">
          <a href="/" className="bouton">Accueil</a>
          <a href="/api/auth/deconnexion" className="bouton">Se déconnecter</a>
        </nav>
      </header>

      <h1 className="titre-page">Configuration</h1>

      <section>
        <h2>Stockage</h2>
        <Stockage />
      </section>

      <Panneau
        icone={iconeLiaison}
        titre="Connectivité externe"
        sousTitre="Accès à internet du serveur, mode manuel, sondes, liens externes"
        resume={reglages.silence ? 'Sondes désactivées' : { auto: 'Automatique', 'hors-ligne': 'Mode manuel : hors ligne', 'en-ligne': 'Mode manuel : en ligne' }[reglages.mode]}
      >
        <ReglagesLiaison initiaux={reglages} />
      </Panneau>

      <Panneau
        icone={iconeAssistant}
        titre={assistant.configure ? assistant.nom : 'Assistant'}
        sousTitre="Identité, personnalité, index des documents, réglages avancés"
        resume={`${etatIndex?.documents ?? '–'} documents indexés`}
      >
        <Assistant initiaux={assistant} defauts={DEFAUTS} etat={etatIndex} />
      </Panneau>

      <Panneau
        icone={iconeLivre}
        titre="Encyclopédie"
        sousTitre="Encyclopédies et wikis au format ZIM"
        resume={resume}
      >
        <h3>Contenu installé ({livres.length})</h3>
        {livres.length === 0 && <p className="vide">Aucun contenu.</p>}
        <div className="grille">
          {livres.map((l, i) => (
            <div key={i} className="carte">
              <strong>{l.titre}</strong>
              <p>{l.description}</p>
              <em>{l.articles.toLocaleString('fr-BE')} articles · {octets(l.taille)}</em>
            </div>
          ))}
        </div>

        <h3>Ajouter du contenu</h3>
        <div className="grille">
          <Packs liaisonInitiale={etatLiaison} />
        </div>
      </Panneau>

      <Panneau
        icone={iconeLivreFerme}
        titre="Bibliothèque"
        sousTitre="Ouvrages de référence au format PDF, lisibles hors ligne"
        resume={pluriel(pdf.filter((l) => l.installe).length, 'livre')}
      >
        <div className="grille">
          <Livres liaisonInitiale={etatLiaison} />
        </div>
      </Panneau>

      <Panneau
        id="guides"
        icone={iconeGuides}
        titre="Comment faire ?"
        sousTitre="Fiches pratiques du blog d'odin-node.com, lisibles hors ligne"
        resume={guides.installe ? `${guides.installe.articles} articles installés` : 'Non installé'}
      >
        <GestionGuides initial={guides} liaisonInitiale={etatLiaison} avecSuppression />
      </Panneau>

      <Panneau
        icone={iconeCarte}
        titre="Cartes"
        sousTitre="Cartes OpenStreetMap hors ligne, par région"
        resume={pluriel(cartes.length, 'carte', 'e')}
      >
        <div className="grille">
          <PacksCartes liaisonInitiale={etatLiaison} />
        </div>
      </Panneau>

      <Panneau
        id="traduction"
        icone={iconeTraduction}
        titre="Traduction"
        sousTitre="Langues de la traduction hors ligne : français et anglais inclus"
        resume={pluriel(langues.length, 'langue', 'e')}
      >
        <div className="grille">
          <PacksTraduction liaisonInitiale={etatLiaison} />
        </div>
      </Panneau>

      <Panneau
        id="point-acces"
        icone={iconeWifi}
        titre="Point d'accès Wi-Fi"
        sousTitre="Réseau Wi-Fi propre à ODIN, sans box ni internet (option non vérifiée sur du vrai matériel)"
        resume={wifi ? ETATS[wifi.etat] || wifi.etat : 'Non installé'}
      >
        {!wifi ? (
          <p>Option non installée. Pour l'activer, relancez l'installeur avec <code>POINT_ACCES=1</code> après <code>sudo</code>.</p>
        ) : (
          <div className="carte">
            <p><strong>État : {ETATS[wifi.etat] || wifi.etat}</strong>{wifi.raison && <> · {RAISONS[wifi.raison] || wifi.raison}</>}</p>
            {wifi.etat !== 'inactif' && (
              <p>Réseau <strong>{wifi.ssid}</strong>{wifi.canal ? ` · canal ${wifi.canal}` : ''}{wifi.pays ? ` · pays ${wifi.pays}` : ''}{wifi.interface ? ` · carte ${wifi.interface}` : ''}</p>
            )}
            {wifi.motDePasse && <p><a href="/point-acces/fiche" className="bouton">Fiche à imprimer (QR codes, mot de passe)</a></p>}
          </div>
        )}
      </Panneau>
    </main>
  );
}

import { etatServices } from '../lib/etat.mjs';
import BarreRecherche from './BarreRecherche';
import Stockage from './Stockage';
import CarteLiaison from './CarteLiaison';
import BandeauSante from './BandeauSante';
import { liaison } from '../lib/liaison.mjs';
import { reglagesAssistant } from '../lib/assistant.mjs';
import Sprite from './assistant/Sprite';

export const dynamic = 'force-dynamic';

const DESCRIPTIONS = {
  assistant: "Il cherche dans vos documents personnels, l'encyclopédie et la bibliothèque, et répond avec ce qu'il y trouve, en citant ses sources.",
  // Card of the assistant while the AI option is not installed: it leads to the installation page
  assistantAbsent: "Option : un modèle de langage qui rédige les réponses à partir des passages trouvés. Demande une carte graphique de 8 Go au moins.",
  bibliotheque: "Encyclopédies et wikis au format ZIM, indexés en plein texte et consultables hors ligne.",
  documents: "Stockage de fichiers personnels sur le serveur, accessible depuis tout navigateur du réseau local.",
  livres: "Ouvrages de référence en PDF, avec leur fiche d'attribution, lisibles hors ligne sur ordinateur comme sur téléphone.",
  traduction: "Traduction de textes entre les langues installées, sur ce serveur, sans internet.",
  carte: "Cartes OpenStreetMap consultables hors ligne, jusqu'au niveau des rues pour les régions installées."
};

const trait = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

const ICONES = {
  assistant: (
    <svg viewBox="0 0 24 24" {...trait}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  ),
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
  livres: (
    <svg viewBox="0 0 24 24" {...trait}>
      <path d="M4 19.5V4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" />
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M14 2v7l2-1.5L18 9V2" />
    </svg>
  ),
  traduction: (
    <svg viewBox="0 0 24 24" {...trait}>
      <path d="M4 5h9" />
      <path d="M8.5 3v2" />
      <path d="M11 5c-1 4-4 7-7 8.5" />
      <path d="M6 8.5c1.2 2 3 3.6 5 4.5" />
      <path d="M12 21l4.5-10L21 21" />
      <path d="M13.6 17.5h5.8" />
    </svg>
  ),
  carte: (
    <svg viewBox="0 0 24 24" {...trait}>
      <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4z" />
      <path d="M8 2v16" />
      <path d="M16 6v16" />
    </svg>
  )
};

export default async function Page() {
  const [etats, etatLiaison] = await Promise.all([etatServices(), liaison()]);
  // Available services first, in the order of SERVICES; the others (not installed, stopped) after them
  const services = [...etats.filter((s) => s.ok), ...etats.filter((s) => !s.ok)];
  const assistant = reglagesAssistant();

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
          {services.map((s) => {
            // The assistant without the AI option: greyed, « Non installé », leads to /ia
            const option = s.id === 'assistant' && !s.ok;
            const perso = s.id === 'assistant' && s.ok && assistant.configure;
            return (
              <a key={s.id} href={option ? '/ia' : s.interne ? s.lien : '/ouvrir/' + s.id} className={option ? 'service service-option' : 'service'} style={perso ? { '--or': assistant.couleur } : undefined}>
                <div className="service-tete">
                  <span className="service-icone">{perso ? <Sprite nom={assistant.avatar} /> : ICONES[s.id]}</span>
                  <span className={s.ok ? 'etat en-ligne' : 'etat arrete'}>{s.ok ? 'Actif' : option ? 'Non installé' : 'Offline'}</span>
                </div>
                <strong>{perso ? assistant.nom : s.nom}</strong>
                <p>{option ? DESCRIPTIONS.assistantAbsent : DESCRIPTIONS[s.id]}</p>
              </a>
            );
          })}
        </div>
      </section>

      <section>
        <h2>Stockage</h2>
        <Stockage />
      </section>

      <section>
        <h2>Connectivité externe</h2>
        <CarteLiaison initiale={etatLiaison} />
      </section>

      <BandeauSante />
    </main>
  );
}

import { reglagesAssistant, demander } from '../../lib/assistant.mjs';
import { DEFAUTS } from '../../assistant/reglages.mjs';
import Espace from './Espace';
import Bienvenue from './Bienvenue';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const { nom, configure } = reglagesAssistant();
  return { title: `${configure ? nom : 'Assistant'} — ODIN` };
}

// ?debug=1 shows the passages and the scores under each answer. The switch is not in the settings:
// it belongs to the moment, not to the household.
export default async function Assistant({ searchParams }) {
  const { debug } = await searchParams;
  const { nom, avatar, couleur, accueil, memoire, configure } = reglagesAssistant();
  if (!configure) {
    return (
      <main style={{ '--or': couleur }}>
        <header className="entete">
          <a href="/" className="retour-accueil"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
          <nav className="entete-liens"><a href="/" className="bouton">Accueil</a></nav>
        </header>
        <h1 className="titre-page">Un nom pour commencer</h1>
        <Bienvenue defauts={DEFAUTS} />
      </main>
    );
  }

  // The worker answers at once; one still starting must not hold the page
  const conversations = await demander('conversations', {}, 3000).catch(() => []);
  return (
    <Espace
      nom={nom}
      avatar={avatar}
      couleur={couleur}
      accueil={accueil}
      memoire={memoire}
      debug={debug === '1'}
      conversations={conversations}
    />
  );
}

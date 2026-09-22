import { reglagesAssistant } from '../../lib/assistant.mjs';
import { DEFAUTS } from '../../assistant/reglages.mjs';
import Chat from './Chat';
import Bienvenue from './Bienvenue';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const { nom, configure } = reglagesAssistant();
  return { title: `${configure ? nom : 'Assistant'} — ODIN` };
}

export default function Assistant() {
  const reglages = reglagesAssistant();
  const { nom, avatar, couleur, accueil, memoire, configure } = reglages;

  return (
    <main className="page-assistant" style={{ '--or': couleur }}>
      <header className="entete">
        <a href="/" className="retour-accueil"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
        <nav className="entete-liens">
          <a href="/configuration#assistant" className="bouton">Réglages</a>
          <a href="/" className="bouton">Accueil</a>
        </nav>
      </header>

      {configure ? (
        <>
          <h1 className="titre-assistant">
            <span className="chat-avatar grand">{avatar === 'image' ? <img src="/api/assistant/avatar" alt="" /> : avatar}</span>
            {nom}
          </h1>
          <Chat nom={nom} avatar={avatar} accueil={accueil} memoire={memoire} />
        </>
      ) : (
        <>
          <h1 className="titre-page">Un nom pour commencer</h1>
          <Bienvenue defauts={DEFAUTS} />
        </>
      )}
    </main>
  );
}

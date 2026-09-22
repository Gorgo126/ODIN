import { reglagesAssistant } from '../../lib/assistant.mjs';
import Chat from './Chat';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Assistant  ODIN' };

// Test page of the assistant (lot 3); naming, avatar and full interface come with lot 4
export default function Assistant() {
  const { nom, memoire } = reglagesAssistant();
  return (
    <main>
      <header className="entete">
        <a href="/"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
        <nav className="entete-liens">
          <a href="/" className="bouton">Accueil</a>
        </nav>
      </header>
      <h1 className="titre-page">{nom}</h1>
      <Chat nom={nom} memoire={memoire} />
    </main>
  );
}

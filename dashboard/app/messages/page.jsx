import { cookies } from 'next/headers';
import { jetonValide, COOKIE } from '../../lib/auth.mjs';
import { TEXTE_MAX, PSEUDO_MAX } from '../../lib/messages.mjs';
import Mur from './Mur';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Messages — ODIN' };

// Local message wall, public (Caddyfile, @messages): the phones of the local network leave a word for
// each other. The delete buttons only exist for a signed-in user; the route checks it again.
export default async function Page() {
  const admin = await jetonValide((await cookies()).get(COOKIE)?.value);
  return (
    <main className="mur">
      <header className="entete">
        <a href="/" className="retour-accueil"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
      </header>
      <h1 className="titre-page">Messages</h1>
      <Mur admin={admin} texteMax={TEXTE_MAX} pseudoMax={PSEUDO_MAX} />
    </main>
  );
}

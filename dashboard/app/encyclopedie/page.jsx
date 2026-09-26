import { contenu } from '../../lib/etat.mjs';
import BarreRecherche from '../BarreRecherche';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Encyclopédie — ODIN' };

const nombre = (n) => n.toLocaleString('fr-FR');

// Installed ZIM packs, each opened on its main page in ODIN's reader. Replaces Kiwix's own library
// page, which is no longer served (Caddyfile): external links are only handled by the reader.
export default async function Encyclopedie() {
  const livres = (await contenu()).filter((l) => l.id).sort((a, b) => a.titre.localeCompare(b.titre, 'fr'));
  return (
    <main>
      <header className="entete">
        <a href="/" className="retour-accueil"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
        <nav className="entete-liens">
          <a href="/configuration" className="bouton">Ajouter des encyclopédies</a>
        </nav>
      </header>
      <h1 className="titre-page">Encyclopédie</h1>
      <BarreRecherche />
      {livres.length === 0 ? (
        <p>Aucune encyclopédie installée. Ajoutez-en depuis <a href="/configuration">Configuration</a>.</p>
      ) : livres.map((l) => (
        <a key={l.id} href={`/lire/${encodeURIComponent(l.id)}`} className="carte resultat">
          <strong>{l.titre}</strong>
          {l.description && <p>{l.description}</p>}
          {l.articles > 0 && <em>{nombre(l.articles)} articles</em>}
        </a>
      ))}
    </main>
  );
}

// Header of the « Comment faire ? » lists, as on /livres
export default function Entete() {
  return (
    <header className="entete">
      <a href="/" className="retour-accueil"><img src="/logo.png" alt="ODIN" className="logo logo-petit" /></a>
      <nav className="entete-liens">
        <a href="/" className="bouton">Accueil</a>
        <a href="/configuration#guides" className="bouton">Configuration</a>
      </nav>
    </header>
  );
}

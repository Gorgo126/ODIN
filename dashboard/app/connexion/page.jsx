import { estConfigure } from '../../lib/auth.mjs';

export const dynamic = 'force-dynamic';

const MESSAGES = {
  incorrect: 'Mot de passe incorrect.',
  court: 'Le mot de passe doit faire au moins 8 caractères.',
  different: 'Les deux mots de passe ne correspondent pas.'
};

export default async function Connexion({ searchParams }) {
  const { erreur, retour = '/' } = await searchParams;
  const premier = !(await estConfigure());

  return (
    <main className="connexion">
      <h1><img src="/logo.png" alt="ODIN" className="logo" /></h1>
      {/* Old terminal screen: amber text, frame label, blinking block cursor */}
      <p className="terminal" data-titre={premier ? 'ODIN · Initialisation' : 'ODIN · Accès protégé'}>
        <span className="terminal-invite" aria-hidden="true">&gt;</span>
        {premier
          ? 'Première utilisation : choisissez le mot de passe qui protégera ce serveur.'
          : 'Connexion requise.'}
        <span className="curseur" aria-hidden="true" />
      </p>
      <form method="post" action="/api/auth/connexion">
        <input type="hidden" name="retour" value={retour} />
        <input type="password" name="mdp" placeholder="Mot de passe" autoFocus required />
        {premier && <input type="password" name="confirmation" placeholder="Confirmer le mot de passe" required />}
        {erreur && <p className="erreur">{MESSAGES[erreur] || 'Erreur.'}</p>}
        <button>{premier ? 'Définir le mot de passe' : 'Se connecter'}</button>
      </form>
      {/* The message wall is public: a visitor without the password finds it from here */}
      <a href="/messages" className="connexion-mur">Mur de messages — accès libre</a>
    </main>
  );
}

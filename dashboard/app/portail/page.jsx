import { etatPointAcces } from '../../lib/portail.mjs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bienvenue — ODIN' };

// Public page of the captive portal. Kept light for the mini browsers of phones (iOS opens it in its
// captive window): a plain HTML form, no script of its own, no cookie, nothing downloaded.
export default async function Portail({ searchParams }) {
  const { libre } = await searchParams;
  const etat = await etatPointAcces();
  const adresse = etat?.adresse || '';
  const nom = (etat?.noms || [])[0];

  return (
    <main className="connexion portail">
      <h1><img src="/logo.png" alt="ODIN" className="logo" /></h1>
      {!libre ? (
        <>
          <p className="terminal" data-titre="ODIN · Réseau Wi-Fi">
            <span className="terminal-invite" aria-hidden="true">&gt;</span>
            Bienvenue sur le réseau d'ODIN : encyclopédie, livres, cartes et traduction, sans internet.
            <span className="curseur" aria-hidden="true" />
          </p>
          <form method="post" action="/api/portail/liberer">
            <button>Continuer</button>
          </form>
        </>
      ) : (
        <>
          <p className="terminal" data-titre="ODIN · Connecté">
            <span className="terminal-invite" aria-hidden="true">&gt;</span>
            C'est fait. Ouvrez votre navigateur habituel et tapez cette adresse :
            <span className="curseur" aria-hidden="true" />
          </p>
          {adresse && <p className="portail-adresse">http://{adresse}</p>}
          {nom && <p className="portail-nom">ou http://{nom}</p>}
          <p className="portail-android">
            <strong>Sur Android</strong> : si une notification signale une connexion limitée ou sans internet,
            choisissez « Utiliser ce réseau » ou « Rester connecté », ou coupez les données mobiles. Sinon,
            le téléphone passe par la 4G et ODIN reste introuvable.
          </p>
        </>
      )}
    </main>
  );
}

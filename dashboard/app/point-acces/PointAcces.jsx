'use client';
import { useEffect, useState } from 'react';
import { RAISONS } from '../../lib/point-acces-textes.mjs';

// Polling: every 2 s while an action runs on the host, every 15 s otherwise
const RAPIDE = 2000;
const LENT = 15000;

// Network name, password and address, big: the page may disappear right after the activation
function Informations({ e }) {
  return (
    <div className="pa-infos">
      <p><span>Nom du réseau</span><strong>{e.ssid}</strong></p>
      <p><span>Mot de passe</span><strong>{e.motDePasse || '—'}</strong></p>
      <p><span>Adresse d'ODIN</span><strong>http://{e.adresse || '—'}</strong>{e.noms?.[0] && <small>ou http://{e.noms[0]}</small>}</p>
      {e.motDePasse && <p className="pa-fiche"><a href="/point-acces/fiche" className="bouton">Fiche à imprimer avec les QR codes</a></p>}
    </div>
  );
}

// The three cases, the one of this machine put forward
function Cas({ e }) {
  const cas = !e.modeAP ? 'carte' : e.routeParDefaut ? 'wifi' : e.autreConnexion ? 'cable' : 'aucune';
  const ligne = (id, titre, texte) => (
    <li className={cas === id ? 'pa-cas-machine' : undefined}>
      {cas === id && <span className="pa-cas-marque">Votre cas</span>}
      <strong>{titre}</strong> {texte}
    </li>
  );
  return (
    <ul className="pa-cas">
      {ligne('cable', 'Connexion par câble :', 'internet est conservé. Le Wi-Fi sert seulement au réseau d\'ODIN.')}
      {ligne('wifi', 'Connexion en Wi-Fi seulement :', 'internet est coupé tant que le point d\'accès est actif. La carte Wi-Fi ne peut pas être à la fois connectée à la box et servir le réseau d\'ODIN.')}
      {ligne('carte', 'Sans carte Wi-Fi compatible :', `le point d'accès est impossible. ${RAISONS[e.raison] || ''}`)}
      {cas === 'aucune' && <li className="pa-cas-machine"><span className="pa-cas-marque">Votre cas</span><strong>Aucune connexion à internet détectée :</strong> rien ne sera coupé.</li>}
    </ul>
  );
}

export default function PointAcces({ initial }) {
  const [e, setE] = useState(initial);
  const [attente, setAttente] = useState(false);
  const [compris, setCompris] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [perdu, setPerdu] = useState(false);
  const [envoye, setEnvoye] = useState(null);

  const enCours = attente || e?.etat === 'en-cours';

  useEffect(() => {
    let arrete = false;
    let minuterie;
    async function charger() {
      try {
        const r = await fetch('/api/point-acces', { cache: 'no-store' });
        if (!r.ok) throw new Error();
        const d = await r.json();
        if (arrete) return;
        setE(d.etat); setAttente(d.attente); setPerdu(false);
        minuterie = setTimeout(charger, d.attente || d.etat?.etat === 'en-cours' ? RAPIDE : LENT);
      } catch {
        // The machine left the network this page came from (Wi-Fi only): say where to find it again
        if (arrete) return;
        setPerdu(true);
        minuterie = setTimeout(charger, RAPIDE);
      }
    }
    minuterie = setTimeout(charger, enCours ? RAPIDE : LENT);
    return () => { arrete = true; clearTimeout(minuterie); };
  }, [enCours]);

  async function envoyer(action) {
    setErreur(null);
    const r = await fetch('/api/point-acces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) { setErreur(d.erreur || 'Demande impossible à transmettre.'); return; }
    setEnvoye(action); setAttente(true); setCompris(false);
  }

  if (!e) return <p>Le point d'accès n'est pas installé sur cette machine : relancez l'installeur d'ODIN.</p>;

  const derniere = e.derniereAction;
  const echec = derniere?.resultat === 'echec' && e.derniereErreur;

  return (
    <div className="pa">
      {perdu && (
        <div className="pa-alerte">
          <strong>Cette page a perdu le contact avec ODIN.</strong>
          {envoye === 'desactiver'
            ? <p>La machine est retournée sur la box : retrouvez-la sur le réseau habituel (même adresse qu'avant l'activation).</p>
            : <p>Rejoignez le réseau Wi-Fi <strong>{e.ssid}</strong> (mot de passe <strong>{e.motDePasse}</strong>), puis ouvrez <strong>http://{e.adresse}</strong>.</p>}
        </div>
      )}
      {echec && <p className="pa-erreur">Dernière action en échec ({derniere.action === 'desactiver' ? 'désactivation' : derniere.action === 'activer' ? 'activation' : 'démarrage'}) : {e.derniereErreur.message}</p>}
      {enCours && <p className="pa-encours">{(derniere?.action || envoye) === 'desactiver' ? 'Désactivation en cours…' : 'Activation en cours… (30 secondes au plus, puis retour automatique à l\'ancienne connexion en cas d\'échec)'}</p>}

      {e.actif ? (
        <>
          <section className="carte pa-actif">
            <h2>Point d'accès actif</h2>
            <p>ODIN émet son propre réseau Wi-Fi{e.canal ? ` (canal ${e.canal}${e.interface ? `, carte ${e.interface}` : ''})` : ''}. Les appareils qui le rejoignent ouvrent ODIN, sans internet.</p>
            <Informations e={e} />
          </section>
          <section className="carte pa-avertissement">
            <h2>Désactiver</h2>
            <p>La carte Wi-Fi retourne sur la box (ou redevient libre). Les appareils connectés au réseau d'ODIN le perdent, et vous aussi si vous passez par lui : <strong>il faudra retrouver ODIN sur le réseau habituel</strong>, à son adresse d'avant.</p>
            <p>Si l'ancienne connexion ne revient pas dans les 30 secondes (box absente, mot de passe changé), ODIN réactive son point d'accès pour rester joignable, et le signale ici.</p>
            <button disabled={enCours} onClick={() => envoyer('desactiver')}>Désactiver le point d'accès</button>
          </section>
        </>
      ) : (
        <>
          <section className="carte">
            <h2>1. À quoi ça sert</h2>
            <p>ODIN crée son propre réseau Wi-Fi. Téléphones et ordinateurs le rejoignent et ouvrent ODIN directement, sans box ni internet : utile là où il n'y a aucun réseau.</p>
          </section>
          <section className="carte">
            <h2>2. Avant de commencer</h2>
            <p>Téléchargez d'abord tout ce dont vous aurez besoin : packs de l'encyclopédie, livres, cartes, langues de traduction, articles « Comment faire ? ». <strong>Internet peut disparaître juste après l'activation.</strong></p>
          </section>
          <section className="carte">
            <h2>3. Ce qui va se passer sur cette machine</h2>
            <Cas e={e} />
          </section>
          <section className="carte pa-avertissement">
            <h2>4. Notez ces informations</h2>
            <p><strong>Si vous êtes connecté à ODIN par Wi-Fi, vous allez perdre cette page.</strong> Pour la retrouver : rejoindre le réseau ci-dessous, puis ouvrir l'adresse d'ODIN. Notez-les ou prenez-les en photo.</p>
            <Informations e={e} />
          </section>
          <section className="carte">
            <h2>5. Filet de sécurité</h2>
            <p>Si le point d'accès n'émet pas dans les 30 secondes, ou s'il s'arrête plus tard (au redémarrage aussi), ODIN revient tout seul à l'ancienne connexion. En dernier recours, dans un terminal de la machine : <code>sudo /opt/odin/scripts/point-acces.sh desactiver</code></p>
          </section>
          <section className="carte">
            <h2>6. Alternative recommandée</h2>
            <p>Un <strong>routeur de voyage</strong> branché sur la machine par un câble Ethernet crée le même réseau, plus simplement et plus fiablement, sans que la machine touche à sa propre connexion. Réglez-le sans internet : les appareils ouvrent alors ODIN à son adresse sur ce réseau.</p>
          </section>
          <section className="carte">
            <h2>7. Statut</h2>
            <p>Fonction expérimentale : testée avec des cartes Wi-Fi virtuelles, <strong>pas encore vérifiée sur du vrai matériel</strong>.</p>
          </section>
          <section className="carte pa-activer">
            <h2>8. Activer</h2>
            {!e.modeAP ? (
              <p className="pa-erreur">Activation impossible : {RAISONS[e.raison] || 'aucune carte Wi-Fi compatible.'}</p>
            ) : e.raison ? (
              <p className="pa-erreur">Activation impossible : {RAISONS[e.raison] || e.raison}</p>
            ) : (
              <label className="pa-compris">
                <input type="checkbox" checked={compris} onChange={(x) => setCompris(x.target.checked)} disabled={enCours} />
                J'ai compris et j'ai noté les informations
              </label>
            )}
            <button disabled={!e.modeAP || !!e.raison || !compris || enCours} onClick={() => envoyer('activer')}>Activer le point d'accès</button>
          </section>
        </>
      )}
      {erreur && <p className="pa-erreur">{erreur}</p>}
    </div>
  );
}

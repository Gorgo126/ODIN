'use client';

import { useCallback, useEffect, useState } from 'react';
import { octets } from '../../lib/format.mjs';
import { useLiaison, messageHorsLigne } from '../useLiaison';
import DateLocale from '../DateLocale';
import { suppressionModeleIA, supprimer } from '../../lib/suppressions.mjs';

const go = (mo) => `${Math.round(mo / 1024)} Go`;
const FABRICANTS = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel', autre: 'Autre' };

// Where the model runs, from the loading test (share of the model in video memory)
function Verification({ v, simule }) {
  if (!v) return null;
  const vitesse = v.motsParSeconde ? <p className="ia-date">Environ {Math.round(v.motsParSeconde)} jetons par seconde au dernier test.</p> : null;
  let texte;
  if (v.gpu == null) texte = <p className="ia-test">Test de chargement fait ; emplacement du modèle inconnu.</p>;
  else if (v.gpu >= 0.99) texte = <p className="ia-test ia-test-ok">Modèle chargé entièrement sur la carte graphique.</p>;
  else if (simule) texte = <p className="ia-test">Simulation : le modèle tourne sur le processeur, c'est normal ici.</p>;
  else if (v.gpu <= 0.01) texte = <p className="ia-test erreur">La carte graphique n'est pas utilisée : le modèle tourne sur le processeur et les réponses seront très lentes. Vérifiez le pilote, puis relancez l'installeur d'ODIN.</p>;
  else texte = <p className="ia-test erreur">Le modèle ne tient pas entièrement dans la carte graphique ({Math.round(v.gpu * 100)} % dessus) : une partie tourne sur le processeur et les réponses seront lentes.</p>;
  return <>{texte}{vitesse}</>;
}

export default function InstallationIA({ initial, liaisonInitiale }) {
  const [e, setE] = useState(initial);
  const [occupe, setOccupe] = useState(null);
  const [erreur, setErreur] = useState(null);
  const liaison = useLiaison(liaisonInitiale);
  const enLigne = !!liaison?.enLigne;
  // « Indisponible hors ligne », or the advice to leave the access point when it is on
  const horsLigne = messageHorsLigne(liaison);

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/ia', { cache: 'no-store' });
      if (r.ok) setE(await r.json());
    } catch {}
  }, []);

  // Progress polled while a download runs
  const enCours = e.tache?.etat === 'en cours';
  useEffect(() => {
    if (!enCours) return;
    const t = setInterval(charger, 1500);
    return () => clearInterval(t);
  }, [enCours, charger]);

  async function action(corps, confirmation) {
    if (confirmation && !confirm(confirmation)) return;
    setErreur(null);
    setOccupe(corps.action);
    try {
      const r = await fetch('/api/ia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErreur(j.erreur || `Erreur ${r.status}`);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setOccupe(null);
      charger();
    }
  }

  async function desinstaller(x) {
    setErreur(null);
    setOccupe('desinstaller');
    const r = await supprimer(suppressionModeleIA(x));
    if (r && !r.ok) setErreur(r.erreur);
    setOccupe(null);
    charger();
  }

  const m = e.materiel;
  const actif = e.modeles.find((x) => x.actif);
  const installe = e.modeles.find((x) => x.installe);

  return (
    <>
      <section className="carte ia-materiel">
        <h3>Matériel détecté{m?.simule && <span className="badge">Simulation</span>}</h3>
        {!m ? <p>Pas encore détecté.</p> : m.cartes.length === 0 ? <p>Aucune carte graphique.</p> : (
          <ul>
            {m.cartes.map((c, i) => (
              <li key={i}>{FABRICANTS[c.fabricant] || c.fabricant} · {c.nom}{c.vram_mo ? ` · ${go(c.vram_mo)} de mémoire` : ''}</li>
            ))}
          </ul>
        )}
        {m && <p className="ia-date">Détecté par l'installeur le <DateLocale t={m.detecte_le} />. Après un changement de carte ou de pilote, relancez l'installeur.</p>}
      </section>

      {!e.possible ? (
        <p className="bandeau-sante ia-verdict">{e.raison}</p>
      ) : (
        <p className="ia-verdict ia-verdict-ok">
          {e.cas === '16' ? 'Votre carte peut faire tourner les deux modèles, y compris le plus grand (14 milliards de paramètres).'
            : 'Votre carte peut faire tourner le modèle de 8 milliards de paramètres.'}
        </p>
      )}

      {erreur && <p className="erreur">{erreur}</p>}

      <section>
        <h3>Modèles</h3>
        {e.modeles.map((x) => {
          const t = e.tache?.id === x.id ? e.tache : null;
          const pct = t?.total ? Math.floor((t.recu / t.total) * 100) : 0;
          let actions;
          if (t?.etat === 'en cours') {
            actions = (
              <div className="progression">
                <div className="jauge"><div style={{ width: pct + '%' }} /></div>
                <em>{t.statut} · {pct} % · {octets(t.recu)} / {octets(t.total)}</em>
                <button onClick={() => action({ action: 'annuler' }, 'Arrêter le téléchargement ? La partie reçue est gardée : il reprendra là où il s\'est arrêté.')}>Annuler</button>
              </div>
            );
          } else if (x.installe) {
            actions = (
              <div className="ia-actions">
                <button disabled={!!occupe} onClick={() => action({ action: 'activer', actif: !x.actif })}>{x.actif ? 'Désactiver' : 'Activer'}</button>
                <button disabled={!!occupe} onClick={() => action({ action: 'tester' })}>{occupe === 'tester' ? 'Test en cours…' : 'Tester'}</button>
                <button disabled={!!occupe} onClick={() => desinstaller(x)}>Désinstaller</button>
              </div>
            );
          } else {
            const bloque = x.bloque || (!enLigne && horsLigne) || (installe && 'Désinstallez d\'abord l\'autre modèle') || (enCours && 'Un autre téléchargement est en cours');
            actions = (
              <div className="ia-actions">
                {t?.etat === 'erreur' && <em className="erreur">{t.erreur}</em>}
                <button disabled={!!bloque || !!occupe} title={bloque || undefined} onClick={() => action({ action: 'installer', id: x.id })}>
                  {t?.etat === 'erreur' || t?.etat === 'annule' ? 'Réessayer' : 'Installer'}
                </button>
                {bloque && <em className="ia-raison">{bloque}</em>}
              </div>
            );
          }
          return (
            <div key={x.id} className={`carte pack ia-modele${x.bloque ? ' ia-modele-bloque' : ''}`}>
              <div>
                <span className="ia-titre"><strong>{x.libelle}</strong>{x.actif && <span className="badge">Actif</span>}</span>
                <em>{octets(x.taille)}{x.memoire_go ? ` · demande ${x.memoire_go} Go de mémoire graphique` : ''} · licence {x.licence}</em>
                <p>{x.description}</p>
                {x.installe && x.empreinteOk === false && <p className="erreur">Version différente de celle vérifiée pour ODIN.</p>}
                {t?.avertissement && <p className="erreur">{t.avertissement}</p>}
              </div>
              {actions}
            </div>
          );
        })}
      </section>

      {actif && (
        <section className="carte ia-etat">
          <h3>{actif.libelle} est actif</h3>
          <Verification v={e.choix.verification} simule={!!m?.simule} />
          <p><a href="/assistant" className="bouton-lire">Ouvrir l'assistant</a></p>
        </section>
      )}
    </>
  );
}

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { octets } from '../lib/format.mjs';
import { useLiaison, HORS_LIAISON } from './useLiaison';

const GROS = 1e9;
const ENORME = 50e9;

export default function PacksCartes({ liaisonInitiale }) {
  const [liste, setListe] = useState(null);
  const enLigne = !!useLiaison(liaisonInitiale)?.enLigne;
  const [tailles, setTailles] = useState({});
  const demandees = useRef(new Set());

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/cartes', { cache: 'no-store' });
      setListe(await r.json());
    } catch {}
  }, []);

  // Reloaded when the link comes back: the map index is only read online
  useEffect(() => { charger(); }, [charger, enLigne]);

  // Sizes come from a dry-run of several seconds each: loaded one pack at a time, after the page
  useEffect(() => {
    if (!enLigne || !liste?.joignable) return;
    let actif = true;
    (async () => {
      for (const p of liste.packs) {
        if (!actif) return;
        if (p.taille || demandees.current.has(p.id)) continue;
        demandees.current.add(p.id);
        try {
          const r = await fetch(`/api/cartes/${p.id}`, { cache: 'no-store' });
          const { taille } = await r.json();
          if (taille) setTailles((t) => ({ ...t, [p.id]: taille }));
        } catch {}
      }
    })();
    return () => { actif = false; };
  }, [liste, enLigne]);

  const enCours = !!liste?.packs.some((p) => p.tache?.etat === 'en cours');

  useEffect(() => {
    if (!enCours) return;
    const t = setInterval(charger, 1500);
    return () => clearInterval(t);
  }, [enCours, charger]);

  async function envoyer(id, method) {
    const r = await fetch(`/api/cartes/${id}`, { method });
    if (!r.ok) alert((await r.json()).erreur);
    charger();
  }

  function installer(p, taille) {
    if (taille >= ENORME && !confirm(`${p.libelle} : ${octets(taille)} à télécharger. Réservez-le à un très grand disque et à une connexion rapide : cela peut prendre plusieurs jours. Continuer ?`)) return;
    if (p.extraction && taille >= GROS && !confirm(`${p.libelle} (${octets(taille)}) est extrait du fichier mondial. Si la connexion est coupée pendant l'extraction, il faudra tout recommencer. Continuer ?`)) return;
    envoyer(p.id, 'POST');
  }

  if (!liste) return <p>Chargement du catalogue</p>;

  return (
    <>
      {!enLigne && <p className="hors-liaison">{HORS_LIAISON} pour ajouter des cartes. Les cartes installées restent utilisables.</p>}
      {enLigne && !liste.joignable && <p>Catalogue des cartes injoignable pour le moment.</p>}
      {liste.packs.map((p) => {
        const t = p.tache;
        const taille = p.taille || tailles[p.id];
        // Offline, the last size measured while online
        const affichee = taille || p.derniereMesure;
        const pct = t?.total ? Math.floor((t.recu / t.total) * 100) : 0;
        let action;

        if (t?.etat === 'en cours') {
          action = (
            <div className="progression">
              <div className="jauge"><div style={{ width: pct + '%' }} /></div>
              <em>{t.preparation ? 'Préparation de l\'extraction' : `${pct} %  ${octets(t.recu)} / ${octets(t.total)}`}</em>
              <button onClick={() => confirm('Annuler le téléchargement ? La partie déjà reçue sera supprimée.') && envoyer(p.id, 'DELETE')}>Annuler</button>
            </div>
          );
        } else if (p.installe) {
          action = (
            <span>
              <em>Installé  {octets(p.surDisque)}</em>
              {!p.protege && (
                <button onClick={() => confirm(`Supprimer la carte « ${p.libelle} » ?`) && envoyer(p.id, 'DELETE')}>Supprimer</button>
              )}
            </span>
          );
        } else {
          action = (
            <span>
              {t?.etat === 'erreur' && <em className="erreur">{t.erreur}</em>}
              <button disabled={!enLigne || !liste.joignable || !taille} title={enLigne ? undefined : HORS_LIAISON} onClick={() => installer(p, taille)}>
                {t?.etat === 'erreur' ? 'Réessayer' : 'Installer'}
              </button>
              {!enLigne && <em className="hors-liaison">{HORS_LIAISON}</em>}
            </span>
          );
        }

        return (
          <div key={p.id} className="carte pack">
            <div>
              <strong>{p.libelle}</strong>
              <em>
                Zoom {p.zoom}
                {!p.installe && (affichee ? `  ${octets(affichee)}${taille ? '' : ' (dernière mesure)'}` : enLigne && liste.joignable ? '  calcul de la taille' : '')}
              </em>
              {affichee >= ENORME && !p.installe && <em className="erreur">Très volumineux</em>}
            </div>
            {action}
          </div>
        );
      })}
    </>
  );
}

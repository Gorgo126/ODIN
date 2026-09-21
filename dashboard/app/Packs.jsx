'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { octets } from '../lib/format.mjs';
import { useLiaison, HORS_LIAISON } from './useLiaison';

export default function Packs({ liaisonInitiale }) {
  const [packs, setPacks] = useState(null);
  const enLigne = !!useLiaison(liaisonInitiale)?.enLigne;
  const router = useRouter();
  const avant = useRef(false);

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/packs', { cache: 'no-store' });
      setPacks(await r.json());
    } catch {}
  }, []);

  // Reloaded when the link comes back: the catalogue is only read online
  useEffect(() => { charger(); }, [charger, enLigne]);

  const enCours = !!packs?.some((p) => p.tache?.etat === 'en cours');

  useEffect(() => {
    if (avant.current && !enCours) router.refresh();
    avant.current = enCours;
    if (!enCours) return;
    const t = setInterval(charger, 1500);
    return () => clearInterval(t);
  }, [enCours, charger, router]);

  async function installer(id) {
    const r = await fetch(`/api/packs/${id}`, { method: 'POST' });
    if (!r.ok) alert((await r.json()).erreur);
    charger();
  }

  async function annuler(id) {
    if (!confirm('Annuler le téléchargement ? La partie déjà reçue sera supprimée.')) return;
    const r = await fetch(`/api/packs/${id}`, { method: 'DELETE' });
    if (!r.ok) alert((await r.json()).erreur);
    charger();
  }

  if (!packs) return <p>Chargement du catalogue</p>;

  return (
    <>
      {!enLigne && <p className="hors-liaison">{HORS_LIAISON} pour ajouter ou mettre à jour du contenu. Le contenu installé reste disponible.</p>}
      {enLigne && packs.length > 0 && packs.every((p) => !p.disponible) && (
        <p>Catalogue Kiwix injoignable pour le moment.</p>
      )}
      {packs.map((p) => {
        const t = p.tache;
        const pct = t?.total ? Math.floor((t.recu / t.total) * 100) : 0;
        let action;

        if (t?.etat === 'en cours') {
          action = (
            <div className="progression">
              <div className="jauge"><div style={{ width: pct + '%' }} /></div>
              <em>{pct} %  {octets(t.recu)} / {octets(t.total)}</em>
              <button onClick={() => annuler(p.id)}>Annuler</button>
            </div>
          );
        } else if (p.installation === 'installe') {
          action = <em>Installé</em>;
        } else {
          action = (
            <span>
              {t?.etat === 'erreur' && <em className="erreur">{t.erreur}</em>}
              <button disabled={!enLigne || !p.disponible} title={enLigne ? undefined : HORS_LIAISON} onClick={() => installer(p.id)}>
                {t?.etat === 'erreur' ? 'Réessayer' : p.installation === 'maj' ? 'Mettre à jour' : p.installation === 'autre' ? 'Remplacer' : 'Installer'}
              </button>
              {!enLigne && <em className="hors-liaison">{HORS_LIAISON}</em>}
            </span>
          );
        }

        return (
          <div key={p.id} className="carte pack">
            <div>
              <strong>{p.libelle}</strong>
              <em>{p.taille ? octets(p.taille) : p.derniereMesure ? `${octets(p.derniereMesure)} (dernière mesure)` : ''}</em>
            </div>
            {action}
          </div>
        );
      })}
    </>
  );
}

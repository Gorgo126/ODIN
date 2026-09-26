'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { octets } from '../lib/format.mjs';
import { useLiaison, HORS_LIAISON } from './useLiaison';
import { suppressionZim, supprimer } from '../lib/suppressions.mjs';

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

  async function desinstaller(p) {
    const r = await supprimer(suppressionZim({ id: p.id, libelle: p.libelle, taille: p.installe }));
    if (!r) return;
    if (!r.ok) alert(r.erreur);
    charger();
    router.refresh();
  }

  if (!packs) return <p>Chargement du catalogue</p>;

  return (
    <>
      {!enLigne && <p className="hors-liaison">{HORS_LIAISON}. Le contenu installé reste consultable.</p>}
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
              <em>{pct} % · {octets(t.recu)} / {octets(t.total)}</em>
              <button onClick={() => annuler(p.id)}>Annuler</button>
            </div>
          );
        } else if (p.installation === 'installe') {
          action = (
            <span>
              <em>Installé</em>
              <button onClick={() => desinstaller(p)}>Désinstaller</button>
            </span>
          );
        } else {
          action = (
            <span>
              {t?.etat === 'erreur' && <em className="erreur">{t.erreur}</em>}
              <button disabled={!enLigne || !p.disponible} title={enLigne ? undefined : HORS_LIAISON} onClick={() => installer(p.id)}>
                {t?.etat === 'erreur' ? 'Réessayer' : p.installation === 'maj' ? 'Mettre à jour' : p.installation === 'autre' ? 'Remplacer' : 'Installer'}
              </button>
              {p.installation === 'maj' && <button onClick={() => desinstaller(p)}>Désinstaller</button>}
              {!enLigne && <em className="hors-liaison">{HORS_LIAISON}</em>}
            </span>
          );
        }

        return (
          <div key={p.id} className="carte pack">
            <div>
              <strong>{p.libelle}</strong>
              <em>{p.taille ? octets(p.taille) : p.derniereMesure ? `${octets(p.derniereMesure)} (dernière mesure)` : ''}{p.licence ? ` · licence ${p.licence}` : ''}</em>
            </div>
            {action}
          </div>
        );
      })}
    </>
  );
}

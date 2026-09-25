'use client';
import { useCallback, useEffect, useState } from 'react';
import { octets } from '../lib/format.mjs';
import { useLiaison, HORS_LIAISON } from './useLiaison';
import { suppressionLangue, supprimer } from '../lib/suppressions.mjs';

// Language packs of the offline translation, like the ZIM packs: size, install, progress, remove
export default function PacksTraduction({ liaisonInitiale }) {
  const [langues, setLangues] = useState(null);
  const enLigne = !!useLiaison(liaisonInitiale)?.enLigne;

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/traduction/packs', { cache: 'no-store' });
      setLangues(await r.json());
    } catch {}
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const enCours = !!langues?.some((l) => l.tache?.etat === 'en cours');
  useEffect(() => {
    if (!enCours) return;
    const t = setInterval(charger, 1500);
    return () => clearInterval(t);
  }, [enCours, charger]);

  async function envoyer(code, method) {
    const r = await fetch(`/api/traduction/packs/${code}`, { method });
    if (!r.ok) alert((await r.json()).erreur);
    charger();
  }

  async function desinstaller(l) {
    const r = await supprimer(suppressionLangue(l));
    if (r && !r.ok) alert(r.erreur);
    if (r) charger();
  }

  if (!langues) return <p>Chargement des langues</p>;
  if (!langues.length) return <p className="vide">Aucune langue dans le catalogue.</p>;

  return (
    <>
      {!enLigne && <p className="hors-liaison">{HORS_LIAISON}. Les langues installées restent utilisables.</p>}
      {langues.map((l) => {
        const t = l.tache;
        const pct = t?.total ? Math.floor((t.recu / t.total) * 100) : 0;
        let action;
        if (t?.etat === 'en cours') {
          action = (
            <div className="progression">
              <div className="jauge"><div style={{ width: pct + '%' }} /></div>
              <em>{pct} %  {octets(t.recu)} / {octets(t.total)}</em>
              <button onClick={() => confirm('Annuler le téléchargement ?') && envoyer(l.code, 'DELETE')}>Annuler</button>
            </div>
          );
        } else if (!suppressionLangue(l)) {
          action = <em>Incluse</em>;
        } else if (l.installee) {
          action = (
            <span>
              <em>Installée</em>
              <button onClick={() => desinstaller(l)}>Désinstaller</button>
            </span>
          );
        } else {
          action = (
            <span>
              {t?.etat === 'erreur' && <em className="erreur">{t.erreur}</em>}
              <button disabled={!enLigne} title={enLigne ? undefined : HORS_LIAISON} onClick={() => envoyer(l.code, 'POST')}>
                {t?.etat === 'erreur' ? 'Réessayer' : 'Installer'}
              </button>
              {!enLigne && <em className="hors-liaison">{HORS_LIAISON}</em>}
            </span>
          );
        }
        return (
          <div key={l.code} className="carte pack">
            <div>
              <strong>{l.nom}</strong>
              <em>{l.base ? 'Base de la traduction' : octets(l.taille)}{l.remarque ? ` · ${l.remarque}` : ''}</em>
            </div>
            {action}
          </div>
        );
      })}
    </>
  );
}

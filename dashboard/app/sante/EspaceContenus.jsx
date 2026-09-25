'use client';
import { useCallback, useEffect, useState } from 'react';
import { octets } from '../../lib/format.mjs';
import { supprimer } from '../../lib/suppressions.mjs';
import DateLocale from '../DateLocale';

const HEURE = { hour: '2-digit', minute: '2-digit', second: '2-digit' };

// Space used by each kind of content, largest first. Computed by the server in the background; read
// again every 2 s while a computation runs. Uninstalls go through the routes of Configuration
// (lib/suppressions.mjs), never through a route of their own.
export default function EspaceContenus({ initial }) {
  const [e, setE] = useState(initial);
  const [erreur, setErreur] = useState(null);

  const charger = useCallback(async (methode = 'GET') => {
    try {
      const r = await fetch('/api/sante/espace', { method: methode, cache: 'no-store' });
      if (r.ok) setE(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (!e.enCours) return;
    const t = setTimeout(charger, 2000);
    return () => clearTimeout(t);
  }, [e, charger]);

  async function desinstaller(el) {
    setErreur(null);
    const r = await supprimer(el.suppression);
    if (!r) return;
    if (!r.ok) setErreur(r.erreur);
    charger();
  }

  const total = e.disque?.utilise || e.categories.reduce((s, g) => s + g.taille, 0);

  return (
    <section>
      <div className="sante-espace-tete">
        <h2>Espace occupé</h2>
        <button type="button" disabled={e.enCours} onClick={() => charger('POST')}>{e.enCours ? 'Calcul en cours…' : 'Recalculer'}</button>
      </div>
      <p className="sante-note">
        {e.calcule ? <>Calculé à <DateLocale t={e.calcule} options={HEURE} />{e.enCours ? ', nouveau calcul en cours' : ''}.</> : 'Premier calcul en cours…'}
      </p>
      {erreur && <p className="erreur">{erreur}</p>}

      {e.categories.map((g) => (
        <div key={g.id} className="carte sante-categorie">
          <div className="sante-categorie-tete">
            <strong>{g.lien ? <a href={g.lien}>{g.nom}</a> : g.nom}</strong>
            <span>{octets(g.taille) || '0 o'}{total ? ` · ${Math.round((g.taille / total) * 100)} %` : ''}</span>
          </div>
          {g.elements.length > 0 && (
            <ul>
              {g.elements.map((el) => (
                <li key={el.id}>
                  <span className="sante-element">{el.nom}{el.enCours && <span className="badge badge-discret">en cours</span>}</span>
                  <span className="sante-taille">{octets(el.taille) || '0 o'}</span>
                  {el.suppression
                    ? <button type="button" onClick={() => desinstaller(el)}>Désinstaller</button>
                    : <span className="sante-fixe" />}
                </li>
              ))}
            </ul>
          )}
          {g.id === 'autre' && <p className="sante-note">Le reste du disque des données : système, images Docker si elles sont sur ce disque, index de recherche, modèle de vecteurs, réglages.</p>}
        </div>
      ))}
    </section>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useLiaison } from './useLiaison';

const LIBELLES = {
  etablie: 'ÉTABLIE',
  degradee: 'DÉGRADÉE',
  rompue: 'ROMPUE',
  silence: 'SILENCE RADIO',
  inconnu: 'VÉRIFICATION'
};
const MODES = { 'hors-ligne': 'FORCÉ HORS LIGNE', 'en-ligne': 'FORCÉ EN LIGNE' };

function depuis(t, maintenant) {
  const s = Math.max(0, Math.floor((maintenant - t) / 1000));
  if (s < 60) return 'à l\'instant';
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h ${m % 60} min`;
  return `il y a ${Math.floor(h / 24)} j ${h % 24} h`;
}

const date = (t) => new Date(t).toLocaleString('fr-BE', { dateStyle: 'long', timeStyle: 'short' });

export default function CarteLiaison({ initiale }) {
  const l = useLiaison(initiale);
  // Times are computed in the browser only (the server runs in UTC), and refresh between two polls
  const [maintenant, setMaintenant] = useState(null);
  useEffect(() => {
    setMaintenant(Date.now());
    const t = setInterval(() => setMaintenant(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  if (!l) return null;
  const voyant = { etablie: 'vert', degradee: 'orange', rompue: 'rouge' }[l.etat] || 'gris';

  return (
    <div className={`liaison liaison-${voyant}`}>
      <div className="liaison-tete">
        <span className={`voyant voyant-${voyant}`} aria-hidden="true" />
        <div className="liaison-etat">
          <strong>LIAISON MONDE : {LIBELLES[l.etat] || l.etat.toUpperCase()}</strong>
          {MODES[l.mode] && (
            <span className="liaison-mode">MODE {MODES[l.mode]} : ODIN se comporte comme {l.enLigne ? 'en ligne' : 'hors ligne'}</span>
          )}
          {!MODES[l.mode] && l.silence && <span className="liaison-mode">Sondes coupées : aucune connexion sortante</span>}
        </div>
      </div>

      <p className="liaison-contact">
        Dernier contact avec le monde :{' '}
        {!maintenant ? <span>…</span> : l.dernierContact
          ? <span title={date(l.dernierContact)}>{depuis(l.dernierContact, maintenant)} <small>({date(l.dernierContact)})</small></span>
          : <span>jamais enregistré</span>}
      </p>

      {!l.silence && l.dernierTest && (
        <details className="liaison-detail">
          <summary>Détail du dernier test{maintenant ? ` (${depuis(l.dernierTest, maintenant)})` : ''}</summary>
          <ul>
            {l.cibles.map((c) => (
              <li key={c.hote}>
                <span className={c.ok ? 'ok-texte' : 'ko-texte'}>{c.ok ? '[OK]' : '[--]'}</span> TCP {c.hote}:443
                {c.ok && ` ${c.ms} ms`}
              </li>
            ))}
            {l.dns && (
              <li>
                <span className={l.dns.ok ? 'ok-texte' : 'ko-texte'}>{l.dns.ok ? '[OK]' : '[--]'}</span> DNS {l.dns.domaine}
                {l.dns.ok && ` ${l.dns.ms} ms`}
              </li>
            )}
          </ul>
        </details>
      )}

      {l.liens.length > 0 && (
        <div className="liaison-liens">
          {l.liens.map((lien) => (l.enLigne
            ? <a key={lien.url} href={lien.url} target="_blank" rel="noopener noreferrer" className="bouton">{lien.libelle} ↗</a>
            : (
              <span key={lien.url} className="bouton desactive" aria-disabled="true" title="Liaison rompue">
                {lien.libelle} <small>Liaison rompue</small>
              </span>
            )))}
        </div>
      )}
    </div>
  );
}

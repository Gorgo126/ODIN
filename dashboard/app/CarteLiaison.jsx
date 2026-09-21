'use client';
import { useEffect, useState } from 'react';
import { useLiaison, HORS_LIAISON } from './useLiaison';

const LIBELLES = {
  etablie: 'EN LIGNE',
  degradee: 'CONNEXION DÉGRADÉE',
  rompue: 'HORS LIGNE',
  silence: 'SONDES DÉSACTIVÉES',
  inconnu: 'VÉRIFICATION EN COURS'
};
const MODES = { 'hors-ligne': 'Mode manuel : hors ligne', 'en-ligne': 'Mode manuel : en ligne' };

function depuis(t, maintenant) {
  const s = Math.max(0, Math.floor((maintenant - t) / 1000));
  if (s < 60) return 'à l\'instant';
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h ${m % 60} min`;
  return `il y a ${Math.floor(h / 24)} j ${h % 24} h`;
}

// JJ/MM/AAAA – HH:MM
function date(t) {
  const d = new Date(t);
  const deux = (n) => String(n).padStart(2, '0');
  return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()} – ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

function diagnostic(l) {
  if (l.silence) return 'Diagnostic : aucun test (sondes désactivées)';
  if (!l.dernierTest) return 'Diagnostic : premier test en cours';
  const n = l.cibles.filter((c) => c.ok).length;
  return `Diagnostic : ${n}/${l.cibles.length} serveurs joignables, DNS ${l.dns?.ok ? 'opérationnel' : 'en échec'}`;
}

export default function CarteLiaison({ initiale }) {
  const l = useLiaison(initiale);
  // Times are computed in the browser only (the server container runs in UTC), and refresh between two polls
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
          <strong>{LIBELLES[l.etat] || l.etat.toUpperCase()}</strong>
          {MODES[l.mode] && <span className="liaison-mode">{MODES[l.mode]}</span>}
        </div>
      </div>

      <p className="liaison-contact">
        {!maintenant ? '…' : l.dernierContact
          ? `Dernière connexion vérifiée : ${date(l.dernierContact)} (${depuis(l.dernierContact, maintenant)})`
          : 'Aucune connexion vérifiée'}
      </p>

      <details className="liaison-detail">
        <summary>{diagnostic(l)}</summary>
        {l.silence ? (
          <p>Aucune connexion sortante tant que les sondes sont désactivées.</p>
        ) : l.dernierTest ? (
          <>
            <p>Dernier test : {maintenant ? `${date(l.dernierTest)} (${depuis(l.dernierTest, maintenant)})` : '…'}</p>
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
          </>
        ) : (
          <p>Le premier test se termine dans quelques secondes.</p>
        )}
      </details>

      {l.liens.length > 0 && (
        <div className="liaison-liens">
          {l.liens.map((lien) => (l.enLigne
            ? <a key={lien.url} href={lien.url} target="_blank" rel="noopener noreferrer" className="bouton">{lien.libelle} ↗</a>
            : (
              <span key={lien.url} className="bouton desactive" aria-disabled="true" title={HORS_LIAISON}>
                {lien.libelle} <small>{HORS_LIAISON}</small>
              </span>
            )))}
        </div>
      )}
    </div>
  );
}

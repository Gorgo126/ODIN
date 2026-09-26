'use client';
import { useEffect, useState } from 'react';
import { octets } from '../../lib/format.mjs';
import JaugeDisque from '../JaugeDisque';
import DateLocale from '../DateLocale';

const JOUR = { day: 'numeric', month: 'long', year: 'numeric' };

const nombre = (n, d = 2) => n.toLocaleString('fr-BE', { minimumFractionDigits: d, maximumFractionDigits: d });

function uptime(s) {
  if (s == null) return '–';
  const j = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return j ? `${j} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

const ETATS = { running: 'En marche', exited: 'Arrêté', restarting: 'Redémarre', paused: 'En pause', created: 'Créé', dead: 'Hors service', removing: 'Suppression' };
const SANTES = { healthy: 'Sain', unhealthy: 'Malade', starting: 'Démarrage' };

// System and containers, read again every 10 s
export default function Sante({ initiale }) {
  const [s, setS] = useState(initiale);

  useEffect(() => {
    let actif = true;
    const t = setInterval(async () => {
      try {
        const r = await fetch('/api/sante', { cache: 'no-store' });
        if (r.ok && actif) setS(await r.json());
      } catch {}
    }, 10000);
    return () => { actif = false; clearInterval(t); };
  }, []);

  const { disque, ram, charge, coeurs } = s.systeme;
  const c = s.conteneurs;
  const v = s.version.odin;

  return (
    <>
      {s.raisons.length > 0 && (
        <p className={`sante-raisons sante-${s.niveau}`}>{s.raisons.join(' · ')}</p>
      )}

      <section>
        <h2>Système</h2>
        <JaugeDisque disque={disque} />
        <div className="sante-chiffres">
          <div className="carte">
            <strong>Mémoire vive</strong>
            {ram ? <em>{octets(ram.utilisee)} utilisés sur {octets(ram.total)} · {octets(ram.disponible)} disponibles</em> : <em>Indisponible</em>}
          </div>
          <div className="carte">
            <strong>Charge</strong>
            <em>{charge ? `${charge.map((x) => nombre(x)).join(' · ')} (1, 5, 15 min) · ${coeurs} cœurs` : 'Indisponible'}</em>
          </div>
          <div className="carte">
            <strong>Allumé depuis</strong>
            <em>{uptime(s.systeme.uptime)}</em>
          </div>
        </div>
      </section>

      <section>
        <h2>Conteneurs</h2>
        {!c.disponible ? (
          <p className="sante-indisponible">État des conteneurs indisponible : le relais Docker (socket-proxy) ne répond pas.</p>
        ) : (
          <div className="sante-tableau">
            <table>
              <thead>
                <tr><th>Nom</th><th>État</th><th>Santé</th><th>Image</th><th>Version</th><th>Depuis</th></tr>
              </thead>
              <tbody>
                {c.liste.map((x) => {
                  const mal = !(x.ponctuel && x.fini) && (x.etat !== 'running' || x.sante === 'unhealthy');
                  return (
                    <tr key={x.nom} className={mal ? 'sante-mal' : undefined}>
                      <td>{x.nom}</td>
                      <td>{x.ponctuel && x.fini ? 'Terminé' : ETATS[x.etat] || x.etat}</td>
                      <td>{x.sante ? SANTES[x.sante] || x.sante : '–'}</td>
                      <td className="sante-image">{x.image}</td>
                      <td className="sante-image">{x.tag}</td>
                      <td>{x.depuis || '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Versions</h2>
        <div className="sante-chiffres">
          <div className="carte">
            <strong>Commit installé</strong>
            <em>{v ? <>{v.commit} · branche {v.branche} · le <DateLocale t={v.installe} options={JOUR} /></> : 'Inconnu (installation antérieure à ce relevé : relancer l\'installeur)'}</em>
          </div>
          <div className="carte">
            <strong>Image du dashboard</strong>
            <em className="sante-image">{s.version.dashboard || '–'}</em>
          </div>
          {c.disponible && c.docker && (
            <div className="carte">
              <strong>Docker</strong>
              <em>{c.docker}</em>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

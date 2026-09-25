'use client';
import { useEffect, useState } from 'react';
import { octets } from '../lib/format.mjs';

// Discreet status strip at the bottom of the home page: disk, memory, containers, version.
// Neutral, orange or red (lib/sante.mjs); read every 30 s from this server only; leads to /sante.
export default function BandeauSante() {
  const [s, setS] = useState(null);

  useEffect(() => {
    let actif = true;
    const lire = async () => {
      try {
        const r = await fetch('/api/sante', { cache: 'no-store' });
        if (r.ok && actif) setS(await r.json());
      } catch {}
    };
    lire();
    const t = setInterval(lire, 30000);
    return () => { actif = false; clearInterval(t); };
  }, []);

  if (!s) return <a href="/sante" className="bandeau-etat">État du serveur…</a>;
  const { disque, ram } = s.systeme;
  const c = s.conteneurs;
  const sains = c.disponible ? c.liste.filter((x) => x.etat === 'running' && x.sante !== 'unhealthy').length : 0;
  const v = s.version.odin;

  return (
    <a href="/sante" className={`bandeau-etat bandeau-etat-${s.niveau}`} title={s.raisons.join(' · ') || 'Détails de l\'état du serveur'}>
      {disque && <span>Disque {disque.pct} % · {octets(disque.libre)} libres</span>}
      {ram && <span>RAM {octets(ram.utilisee)} / {octets(ram.total)}</span>}
      <span>{c.disponible ? `Conteneurs ${sains}/${c.liste.length} sains` : 'Conteneurs : état indisponible'}</span>
      <span>ODIN {v ? v.commit : 'version inconnue'}</span>
      {s.raisons.length > 0 && <strong>{s.raisons[0]}{s.raisons.length > 1 ? ` (+${s.raisons.length - 1})` : ''}</strong>}
    </a>
  );
}

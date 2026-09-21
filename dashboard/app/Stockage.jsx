import { espaceDisque, octets } from '../lib/etat.mjs';

export default async function Stockage() {
  const disque = await espaceDisque();
  if (!disque) return <p>Indisponible</p>;

  const pct = Math.round((disque.utilise / disque.total) * 100);
  const niveau = pct >= 90 ? 'critique' : pct >= 80 ? 'alerte' : '';

  return (
    <div className="stockage">
      <div className="stockage-chiffres">
        <span className="stockage-pct">{pct}<small>%</small></span>
        <span className="stockage-detail">
          {octets(disque.utilise)} utilisés sur {octets(disque.total)}<br />
          <strong>{octets(disque.libre)}</strong> disponibles
        </span>
      </div>
      <div className={`stockage-barre ${niveau}`}>
        <div className="stockage-rempli" style={{ '--pct': pct + '%' }} />
      </div>
    </div>
  );
}

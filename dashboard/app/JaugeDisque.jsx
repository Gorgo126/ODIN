import { octets, niveauDisque } from '../lib/format.mjs';

// Gold block gauge of the data disk: home page (Stockage) and /sante. No hook: usable from server
// and client components alike.
export default function JaugeDisque({ disque }) {
  if (!disque) return <p>Indisponible</p>;
  const pct = Math.round((disque.utilise / disque.total) * 100);

  return (
    <div className="stockage">
      <div className="stockage-chiffres">
        <span className="stockage-pct">{pct}<small>%</small></span>
        <span className="stockage-detail">
          {octets(disque.utilise)} utilisés sur {octets(disque.total)}<br />
          <strong>{octets(disque.libre)}</strong> disponibles
        </span>
      </div>
      <div className={`stockage-barre ${niveauDisque(pct)}`}>
        <div className="stockage-rempli" style={{ '--pct': pct + '%' }} />
      </div>
    </div>
  );
}

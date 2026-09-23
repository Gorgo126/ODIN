// « Recherche en cours… » in ODIN's style: a sunken bar with moving gold blocks
export default function Chargement({ texte = 'Recherche en cours…' }) {
  return (
    <div className="chargement" role="status" aria-live="polite">
      <span>{texte}</span>
      <span className="chargement-barre"><span /></span>
    </div>
  );
}

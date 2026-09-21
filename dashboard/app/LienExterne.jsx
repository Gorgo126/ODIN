'use client';
import { useLiaison, HORS_LIAISON } from './useLiaison';

// Link leaving ODIN: greyed, never hidden, while the server has no internet
export default function LienExterne({ href, children, liaisonInitiale }) {
  const enLigne = !!useLiaison(liaisonInitiale)?.enLigne;
  return enLigne
    ? <a href={href} target="_blank" rel="noopener noreferrer" className="bouton">{children} ↗</a>
    : (
      <span className="bouton desactive" aria-disabled="true" title={HORS_LIAISON}>
        {children} <small>{HORS_LIAISON}</small>
      </span>
    );
}

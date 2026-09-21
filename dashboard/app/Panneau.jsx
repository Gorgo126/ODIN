'use client';
import { useState } from 'react';

export default function Panneau({ icone, titre, sousTitre, resume, children }) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <section className={`panneau${ouvert ? ' ouvert' : ''}`}>
      <button type="button" className="panneau-tete" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
        <span className="service-icone">{icone}</span>
        <span className="panneau-titres">
          <strong>{titre}</strong>
          <span>{sousTitre}</span>
        </span>
        {resume && <span className="panneau-resume">{resume}</span>}
        <span className="panneau-bascule">{ouvert ? '[]' : '[+]'}</span>
      </button>
      <div className="panneau-corps">
        <div className="panneau-interieur">{children}</div>
      </div>
    </section>
  );
}

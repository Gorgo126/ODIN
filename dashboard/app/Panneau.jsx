'use client';
import { useEffect, useState } from 'react';

// id: anchor of the panel; /configuration#id opens it (link « Ajouter des langues » of /traduction)
export default function Panneau({ id, icone, titre, sousTitre, resume, children }) {
  const [ouvert, setOuvert] = useState(false);
  useEffect(() => { if (id && window.location.hash === `#${id}`) setOuvert(true); }, [id]);

  return (
    <section id={id} className={`panneau${ouvert ? ' ouvert' : ''}`}>
      <button type="button" className="panneau-tete" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
        <span className="service-icone">{icone}</span>
        <span className="panneau-titres">
          <strong>{titre}</strong>
          <span>{sousTitre}</span>
        </span>
        {resume && <span className="panneau-resume">{resume}</span>}
        <span className="panneau-bascule">{ouvert ? '[−]' : '[+]'}</span>
      </button>
      <div className="panneau-corps">
        <div className="panneau-interieur">{children}</div>
      </div>
    </section>
  );
}

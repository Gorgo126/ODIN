'use client';
import { useEffect, useState } from 'react';

const TAILLES = [0.9, 1, 1.1, 1.25, 1.4];

export default function Lecteur({ livre, livreLien, titre, html, kiwix }) {
  const [taille, setTaille] = useState(2);

  useEffect(() => {
    try {
      const v = parseInt(localStorage.getItem('odin-taille') ?? '2', 10);
      if (v >= 0 && v < TAILLES.length) setTaille(v);
    } catch {}
  }, []);

  useEffect(() => { document.title = `${titre}  ODIN`; }, [titre]);

  function changer(delta) {
    const v = Math.min(TAILLES.length - 1, Math.max(0, taille + delta));
    setTaille(v);
    try { localStorage.setItem('odin-taille', String(v)); } catch {}
  }

  return (
    <div className="lecture">
      <nav className="barre">
        <a href="/" className="accueil"> ODIN</a>
        <span className="sep"></span>
        <a href={livreLien}>{livre}</a>
        <span className="sep"></span>
        <span className="titre">{titre}</span>
        <span className="outils">
          <button onClick={() => changer(-1)} title="Réduire le texte">A</button>
          <button onClick={() => changer(1)} title="Agrandir le texte">A+</button>
          <a href={`/ouvrir/bibliotheque?chemin=${encodeURIComponent(kiwix)}`} title="Ouvrir dans Kiwix"></a>
        </span>
      </nav>
      <article
        className="article"
        style={{ '--taille-lecture': TAILLES[taille] + 'rem' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

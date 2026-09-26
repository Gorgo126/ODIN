'use client';
import { useEffect, useState } from 'react';
import { useLiaison, HORS_LIAISON } from '../../../useLiaison';

const TAILLES = [0.9, 1, 1.1, 1.25, 1.4];

// Also the reader of the « Comment faire ? » articles: no Kiwix link there, and a class of its own
export default function Lecteur({ livre, livreLien, titre, html, licence, liaisonInitiale, classe = '' }) {
  const [taille, setTaille] = useState(2);
  const [avis, setAvis] = useState(false);
  const horsLiaison = !useLiaison(liaisonInitiale)?.enLigne;

  // External links of the article need the world link: greyed and blocked without it
  function cliquer(e) {
    if (horsLiaison && e.target.closest('a[data-externe]')) {
      e.preventDefault();
      setAvis(true);
      setTimeout(() => setAvis(false), 4000);
    }
  }

  useEffect(() => {
    try {
      const v = parseInt(localStorage.getItem('odin-taille') ?? '2', 10);
      if (v >= 0 && v < TAILLES.length) setTaille(v);
    } catch {}
  }, []);

  useEffect(() => { document.title = `${titre} — ODIN`; }, [titre]);

  function changer(delta) {
    const v = Math.min(TAILLES.length - 1, Math.max(0, taille + delta));
    setTaille(v);
    try { localStorage.setItem('odin-taille', String(v)); } catch {}
  }

  return (
    <div className={`lecture${classe ? ` ${classe}` : ''}`}>
      <nav className="barre">
        <a href="/" className="accueil">ODIN</a>
        <span className="sep">/</span>
        <a href={livreLien}>{livre}</a>
        <span className="sep">/</span>
        <span className="titre">{titre}</span>
        <span className="outils">
          <button onClick={() => changer(-1)} title="Réduire le texte">A−</button>
          <button onClick={() => changer(1)} title="Agrandir le texte">A+</button>
        </span>
      </nav>
      {avis && <p className="avis-liaison">Lien externe : {HORS_LIAISON.toLowerCase()}.</p>}
      <article
        className={`article${horsLiaison ? ' hors-liaison' : ''}`}
        onClick={cliquer}
        style={{ '--taille-lecture': TAILLES[taille] + 'rem' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {licence && (
        <footer className={`lecture-licence${horsLiaison ? ' hors-liaison' : ''}`} onClick={cliquer}>
          Texte{licence.auteurs ? ` : ${licence.auteurs}` : ''}, licence{' '}
          {licence.url ? <a href={licence.url} data-externe="">{licence.licence}</a> : licence.licence}.
          {licence.note && ` ${licence.note}`}
        </footer>
      )}
    </div>
  );
}

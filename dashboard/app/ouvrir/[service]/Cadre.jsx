'use client';
import { useEffect, useRef, useState } from 'react';

export default function Cadre({ nom, lien }) {
  const cadre = useRef(null);
  const [src, setSrc] = useState(null);
  const [cle, setCle] = useState(0);
  const [titre, setTitre] = useState('');
  const [actuel, setActuel] = useState('');

  // Adresse de départ : le service, ou la page où l'on était avant un rechargement
  useEffect(() => {
    const chemin = new URLSearchParams(location.search).get('chemin');
    setSrc(chemin && chemin.startsWith(lien) ? chemin : lien);
  }, [lien]);

  // Suit la navigation dans le cadre
  useEffect(() => {
    if (!src) return;
    const t = setInterval(() => {
      try {
        const w = cadre.current.contentWindow;
        const chemin = w.location.pathname + w.location.search + w.location.hash;
        setTitre(w.document.title || '');
        setActuel(chemin);
        const url = `${location.pathname}?chemin=${encodeURIComponent(chemin)}`;
        if (location.pathname + location.search !== url) history.replaceState(null, '', url);
      } catch {}
    }, 1000);
    return () => clearInterval(t);
  }, [src]);

  useEffect(() => {
    document.title = `${titre && titre !== nom ? titre + '  ' : ''}${nom}  ODIN`;
  }, [titre, nom]);

  function revenir() {
    setSrc(lien);
    setTitre('');
    setCle((c) => c + 1);
  }

  return (
    <div className="cadre">
      <nav className="barre">
        <a href="/" className="accueil"> ODIN</a>
        <span className="sep"></span>
        <button onClick={revenir}>{nom}</button>
        {titre && titre !== nom && (
          <>
            <span className="sep"></span>
            <span className="titre">{titre}</span>
          </>
        )}
        {src && (
          <a className="externe" href={actuel || src} target="_blank" rel="noopener" title="Ouvrir dans un nouvel onglet"></a>
        )}
      </nav>
      {src && (
        <iframe
          key={cle}
          ref={cadre}
          src={src}
          title={nom}
          allow="clipboard-read; clipboard-write; microphone; fullscreen"
        />
      )}
    </div>
  );
}

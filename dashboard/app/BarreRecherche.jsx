'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// Search bar of the home page and of /recherche. The button is disabled while a search runs
// (occupe, or the navigation started here); Enter still starts a new one, which replaces the
// previous. Without JavaScript, the form still works as a plain GET.
export default function BarreRecherche({ valeur = '', occupe = false, onLancer }) {
  const router = useRouter();
  const [navigation, demarrer] = useTransition();
  const [texte, setTexte] = useState(valeur);
  useEffect(() => setTexte(valeur), [valeur]);
  const bloque = occupe || navigation;

  const lancer = (e) => {
    e.preventDefault();
    const q = texte.trim();
    if (!q) return;
    const url = `/recherche?q=${encodeURIComponent(q)}`;
    if (onLancer) onLancer(url);
    else demarrer(() => router.push(url));
  };

  return (
    <form action="/recherche" method="get" className="recherche" onSubmit={lancer} aria-busy={bloque}>
      <input
        type="search" name="q" value={texte} onChange={(e) => setTexte(e.target.value)}
        // A disabled button blocks the implicit submission: Enter relaunches by hand
        onKeyDown={(e) => { if (e.key === 'Enter' && bloque) lancer(e); }}
        placeholder="Une question, des mots-clés…"
      />
      <button disabled={bloque}>{bloque ? 'Recherche…' : 'Rechercher'}</button>
    </form>
  );
}

'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import BarreRecherche from '../BarreRecherche';
import Passages from './Passages';
import Chargement from './Chargement';

// Search bar and results of /recherche. While a search runs (the page being fetched, then the
// advanced passages), the results make way for « Recherche en cours… » and the button is disabled.
// A new search replaces the running one: the navigation is superseded and the passages request
// is aborted when its component goes away.
export default function ZoneRecherche({ valeur, avancee, debug, children }) {
  const router = useRouter();
  const [navigation, demarrer] = useTransition();
  const [passagesEnCours, setPassagesEnCours] = useState(avancee);
  useEffect(() => setPassagesEnCours(avancee), [valeur, avancee]);

  const lancer = (url) => demarrer(() => router.push(debug ? `${url}&debug=1` : url));

  return (
    <>
      <BarreRecherche valeur={valeur} occupe={navigation || passagesEnCours} onLancer={lancer} />
      {navigation ? <Chargement /> : (
        <>
          {avancee && <Passages key={valeur} question={valeur} debug={debug} onEtat={setPassagesEnCours} />}
          <div hidden={passagesEnCours}>{children}</div>
        </>
      )}
    </>
  );
}

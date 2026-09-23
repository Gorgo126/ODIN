'use client';

import { useEffect, useState } from 'react';

// A date and time in the visitor's time zone. Formatted in the browser only: the server runs in UTC,
// and a different text would break the hydration of the page (React error 418).
export default function DateLocale({ t, options, vide = 'jamais' }) {
  const [texte, setTexte] = useState(t ? '…' : vide);
  useEffect(() => { setTexte(t ? new Date(t).toLocaleString('fr-BE', options) : vide); }, [t, options, vide]);
  return texte;
}

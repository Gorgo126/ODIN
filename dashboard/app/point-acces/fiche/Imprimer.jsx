'use client';

export default function Imprimer() {
  return <button type="button" className="bouton" onClick={() => window.print()}>Imprimer</button>;
}

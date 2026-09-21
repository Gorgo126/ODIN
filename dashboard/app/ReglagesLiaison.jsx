'use client';
import { useState } from 'react';
import { rafraichirLiaison } from './useLiaison';

const MODES = [
  ['auto', 'Automatique', 'selon les sondes de connectivité'],
  ['hors-ligne', 'Mode manuel : hors ligne', 'les fonctions qui demandent internet sont indisponibles'],
  ['en-ligne', 'Mode manuel : en ligne', 'les fonctions restent actives, même si les sondes échouent']
];

export default function ReglagesLiaison({ initiaux }) {
  const [mode, setMode] = useState(initiaux.mode);
  const [silence, setSilence] = useState(initiaux.silence);
  const [liens, setLiens] = useState(initiaux.liens);
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');

  const modifier = (i, champ, v) => setLiens((l) => l.map((x, j) => (j === i ? { ...x, [champ]: v } : x)));

  async function enregistrer(e) {
    e.preventDefault();
    setMessage('');
    setErreur('');
    try {
      const r = await fetch('/api/reglages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, silence, liens })
      });
      const reponse = await r.json();
      if (!r.ok) throw new Error(reponse.erreur);
      setLiens(reponse.liens);
      rafraichirLiaison(reponse);
      setMessage('Réglages enregistrés.');
    } catch (err) {
      setErreur(err.message || 'Enregistrement impossible');
    }
  }

  return (
    <form className="reglages" onSubmit={enregistrer}>
      <fieldset>
        <legend>Mode</legend>
        {MODES.map(([v, libelle, aide]) => (
          <label key={v}>
            <input type="radio" name="mode" value={v} checked={mode === v} onChange={() => setMode(v)} />
            <span>{libelle}<small>{aide}</small></span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Sondes</legend>
        <label>
          <input type="checkbox" checked={silence} onChange={(e) => setSilence(e.target.checked)} />
          <span>Désactiver les sondes de connectivité<small>aucune connexion sortante ; en mode automatique, ODIN se comporte comme hors ligne</small></span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Liens externes</legend>
        {liens.map((l, i) => (
          <div key={i} className="reglages-lien">
            <input aria-label="Libellé" placeholder="Libellé" value={l.libelle} onChange={(e) => modifier(i, 'libelle', e.target.value)} />
            <input aria-label="Adresse" placeholder="https://" value={l.url} onChange={(e) => modifier(i, 'url', e.target.value)} />
            <button type="button" onClick={() => setLiens((x) => x.filter((_, j) => j !== i))} title="Retirer ce lien">×</button>
          </div>
        ))}
        {liens.length < 20 && (
          <button type="button" onClick={() => setLiens((x) => [...x, { libelle: '', url: '' }])}>Ajouter un lien</button>
        )}
      </fieldset>

      <div className="reglages-actions">
        <button type="submit">Enregistrer</button>
        {message && <em>{message}</em>}
        {erreur && <em className="erreur">{erreur}</em>}
      </div>
    </form>
  );
}

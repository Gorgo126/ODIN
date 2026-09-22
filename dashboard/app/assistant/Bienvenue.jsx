'use client';
import { useState } from 'react';
import Sprite, { VISAGES } from './Sprite';

const COULEURS = ['#d4a04a', '#4ba3c7', '#6fbf73', '#c76b6b', '#a98bd4', '#c9c9c9'];

// First visit: the assistant gets its name, its face and its colour. Everything can be changed
// later in Configuration.
export default function Bienvenue({ defauts }) {
  const [nom, setNom] = useState('');
  const [avatar, setAvatar] = useState(defauts.avatar);
  const [couleur, setCouleur] = useState(defauts.couleur);
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);

  async function valider(e) {
    e.preventDefault();
    const choisi = nom.trim();
    if (!choisi) { setErreur('Donne-lui un nom.'); return; }
    setOccupe(true);
    setErreur('');
    try {
      const r = await fetch('/api/assistant/reglages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom: choisi, avatar, couleur, configure: true })
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erreur || 'Enregistrement impossible');
      location.reload();
    } catch (err) {
      setErreur(err.message);
      setOccupe(false);
    }
  }

  return (
    <form className="bienvenue reglages" onSubmit={valider} style={{ '--or': couleur }}>
      <p className="bienvenue-intro">
        Cet assistant cherche dans tes documents, dans la bibliothèque et dans tes livres, et répond avec ce qu'il y trouve.
        Pour commencer, donne-lui un nom et un visage.
      </p>

      <div className="bienvenue-apercu">
        <span className="chat-avatar grand"><Sprite nom={avatar} /></span>
        <strong>{nom.trim() || 'Sans nom'}</strong>
      </div>

      <fieldset>
        <legend>Nom</legend>
        <input value={nom} onChange={(e) => setNom(e.target.value)} maxLength={40} placeholder="Hugin, Mémo, Bib…" aria-label="Nom de l'assistant" autoFocus />
      </fieldset>

      <fieldset>
        <legend>Visage</legend>
        <div className="choix-visages">
          {VISAGES.map((v) => (
            <button type="button" key={v} className={`visage${avatar === v ? ' choisi' : ''}`} onClick={() => setAvatar(v)} aria-label={v} title={v}>
              <Sprite nom={v} />
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Couleur</legend>
        <div className="choix-couleurs">
          {COULEURS.map((c) => (
            <button type="button" key={c} style={{ background: c }} className={couleur === c ? 'choisi' : ''} onClick={() => setCouleur(c)} aria-label={`Couleur ${c}`} />
          ))}
          <input type="color" value={couleur} onChange={(e) => setCouleur(e.target.value)} aria-label="Autre couleur" />
        </div>
      </fieldset>

      {erreur && <p className="erreur">{erreur}</p>}
      <div className="reglages-actions">
        <button type="submit" disabled={occupe}>{occupe ? 'Enregistrement…' : 'C\'est parti'}</button>
      </div>
    </form>
  );
}

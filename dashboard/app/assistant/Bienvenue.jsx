'use client';
import { useRef, useState } from 'react';

const EMOJIS = ['🦉', '🤖', '📚', '🧭', '🦊', '🐢', '🛰️', '🕯️', '⚙️', '🧠'];
const COULEURS = ['#d4a04a', '#4ba3c7', '#6fbf73', '#c76b6b', '#a98bd4', '#c9c9c9'];

// First visit: the assistant gets its name, its face and its colour. Everything can be changed
// later in Configuration.
export default function Bienvenue({ defauts }) {
  const [nom, setNom] = useState('');
  const [avatar, setAvatar] = useState(defauts.avatar);
  const [image, setImage] = useState(null);
  const [apercu, setApercu] = useState(null);
  const [couleur, setCouleur] = useState(defauts.couleur);
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);
  const fichier = useRef(null);

  async function choisirImage(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErreur('');
    if (f.size > 300 * 1024) { setErreur('Image trop lourde (300 Ko au plus).'); return; }
    setImage(f);
    setApercu((a) => { if (a) URL.revokeObjectURL(a); return URL.createObjectURL(f); });
    setAvatar('image');
  }

  async function valider(e) {
    e.preventDefault();
    const choisi = nom.trim();
    if (!choisi) { setErreur('Donne-lui un nom.'); return; }
    setOccupe(true);
    setErreur('');
    try {
      if (image) {
        const r = await fetch('/api/assistant/avatar', { method: 'POST', headers: { 'Content-Type': image.type }, body: image });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erreur || 'Image refusée');
      }
      const r = await fetch('/api/assistant/reglages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom: choisi, couleur, configure: true, ...(image ? {} : { avatar }) })
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
        <span className="chat-avatar grand">{apercu ? <img src={apercu} alt="" /> : avatar}</span>
        <strong>{nom.trim() || 'Sans nom'}</strong>
      </div>

      <fieldset>
        <legend>Nom</legend>
        <input value={nom} onChange={(e) => setNom(e.target.value)} maxLength={40} placeholder="Hugin, Mémo, Bib…" aria-label="Nom de l'assistant" autoFocus />
      </fieldset>

      <fieldset>
        <legend>Visage</legend>
        <div className="choix-emojis">
          {EMOJIS.map((e) => (
            <button type="button" key={e} className={avatar === e && !image ? 'choisi' : ''} onClick={() => { setImage(null); setAvatar(e); }}>{e}</button>
          ))}
          <input className="emoji-libre" value={image || EMOJIS.includes(avatar) ? '' : avatar} onChange={(e) => { setImage(null); setAvatar(e.target.value.slice(0, 8)); }} placeholder="ou le tien" aria-label="Autre emoji" />
        </div>
        <input ref={fichier} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={choisirImage} aria-label="Image" />
        {image && <button type="button" onClick={() => { setImage(null); setApercu(null); setAvatar(defauts.avatar); fichier.current.value = ''; }}>Retirer l'image</button>}
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

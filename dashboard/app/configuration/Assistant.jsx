'use client';
import { useEffect, useState } from 'react';
import Sprite, { VISAGES } from '../assistant/Sprite';
import DateLocale from '../DateLocale';

const LONGUEURS = [['courte', 'Courte', 'une ou deux phrases'], ['adaptee', 'Adaptée', 'selon la question'], ['detaillee', 'Détaillée', 'développe quand il le faut']];
const COULEURS = ['#d4a04a', '#4ba3c7', '#6fbf73', '#c76b6b', '#a98bd4', '#c9c9c9'];

const COURT = { dateStyle: 'short', timeStyle: 'short' };

// Settings of the assistant and state of its index. One password, one profile: what is set here is
// shared by everyone. Everything else (sentences, thresholds, models…) lives in assistant/constantes.mjs.
export default function Assistant({ initiaux, defauts, etat: etatInitial }) {
  const [r, setR] = useState(initiaux);
  const [etat, setEtat] = useState(etatInitial);
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);

  const maj = (champs) => setR((v) => ({ ...v, ...champs }));
  const majPerso = (champs) => setR((v) => ({ ...v, personnalite: { ...v.personnalite, ...champs } }));

  // While an indexing runs, the state refreshes by itself
  useEffect(() => {
    const t = setInterval(async () => {
      if (!etat?.enCours) return;
      try { setEtat(await (await fetch('/api/assistant/index')).json()); } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [etat?.enCours]);

  async function rafraichirEtat() {
    try { setEtat(await (await fetch('/api/assistant/index')).json()); } catch {}
  }

  async function enregistrer(e) {
    e.preventDefault();
    setMessage('');
    setErreur('');
    setOccupe(true);
    try {
      const rep = await fetch('/api/assistant/reglages', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) });
      const corps = await rep.json();
      if (!rep.ok) throw new Error(corps.erreur);
      setR(corps.reglages);
      setMessage('Réglages enregistrés.');
    } catch (err) {
      setErreur(err.message || 'Enregistrement impossible');
    } finally {
      setOccupe(false);
    }
  }

  async function reindexer(complet) {
    if (complet && !confirm('Tout réindexer relit et revectorise chaque document. Continuer ?')) return;
    setMessage('');
    try {
      setEtat(await (await fetch('/api/assistant/index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ complet }) })).json());
      setMessage(complet ? 'Réindexation complète lancée.' : 'Indexation lancée.');
    } catch {
      setErreur('Indexation impossible');
    }
  }

  const problemes = etat?.problemes || [];

  return (
    <form className="reglages" onSubmit={enregistrer} id="assistant" style={{ '--or': r.couleur }}>
      <fieldset>
        <legend>Index des documents</legend>
        <p className="assistant-index">
          <strong>{etat?.documents ?? '–'}</strong> documents · <strong>{etat?.morceaux ?? '–'}</strong> morceaux ·
          dernière indexation <DateLocale t={etat?.derniereIndexation} options={COURT} />
          {etat?.enCours && <> · en cours : {etat.enCours.fait}/{etat.enCours.total} {etat.enCours.fichier ? `(${etat.enCours.fichier})` : ''}</>}
          {etat?.erreurOllama && <><br /><span className="erreur">{etat.erreurOllama}</span></>}
        </p>
        {problemes.length > 0 && (
          <details className="assistant-problemes">
            <summary>{problemes.length} fichier{problemes.length > 1 ? 's' : ''} non indexé{problemes.length > 1 ? 's' : ''}</summary>
            <ul>{problemes.map((p) => <li key={p.chemin}><code>{p.chemin}</code> — {p.erreur}</li>)}</ul>
          </details>
        )}
        <div className="reglages-actions">
          <button type="button" onClick={() => reindexer(false)}>Réindexer</button>
          <button type="button" onClick={() => reindexer(true)}>Tout réindexer</button>
          <button type="button" onClick={rafraichirEtat}>Rafraîchir</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Identité</legend>
        <label className="ligne">
          <span>Nom</span>
          <input value={r.nom} maxLength={40} onChange={(e) => maj({ nom: e.target.value })} />
        </label>
        <div className="choix-visages">
          {VISAGES.map((v) => (
            <button type="button" key={v} className={`visage${r.avatar === v ? ' choisi' : ''}`} onClick={() => maj({ avatar: v })} aria-label={v} title={v}>
              <Sprite nom={v} />
            </button>
          ))}
        </div>
        <div className="choix-couleurs">
          {COULEURS.map((c) => (
            <button type="button" key={c} style={{ background: c }} className={r.couleur === c ? 'choisi' : ''} onClick={() => maj({ couleur: c })} aria-label={`Couleur ${c}`} />
          ))}
          <input type="color" value={r.couleur} onChange={(e) => maj({ couleur: e.target.value })} aria-label="Autre couleur" />
        </div>
      </fieldset>

      <fieldset>
        <legend>Personnalité</legend>
        <label className="ligne">
          <span>Ton</span>
          <input value={r.personnalite.ton} maxLength={200} onChange={(e) => majPerso({ ton: e.target.value })} />
        </label>
        <label><input type="checkbox" checked={r.personnalite.tutoiement} onChange={(e) => majPerso({ tutoiement: e.target.checked })} /><span>Tutoiement<small>sinon vouvoiement</small></span></label>
        {LONGUEURS.map(([v, libelle, aide]) => (
          <label key={v}>
            <input type="radio" name="longueur" checked={r.personnalite.longueur === v} onChange={() => majPerso({ longueur: v })} />
            <span>{libelle}<small>{aide}</small></span>
          </label>
        ))}
        <button type="button" onClick={() => { majPerso(defauts.personnalite); setMessage('Personnalité remise par défaut : enregistre pour confirmer.'); }}>Réinitialiser la personnalité</button>
      </fieldset>

      <div className="reglages-actions">
        <button type="submit" disabled={occupe}>{occupe ? 'Enregistrement…' : 'Enregistrer'}</button>
        {message && <span className="assistant-message">{message}</span>}
        {erreur && <span className="erreur">{erreur}</span>}
      </div>
    </form>
  );
}

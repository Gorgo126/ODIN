'use client';
import { useEffect, useRef, useState } from 'react';

const LONGUEURS = [['courte', 'Courte', 'une ou deux phrases'], ['adaptee', 'Adaptée', 'selon la question'], ['detaillee', 'Détaillée', 'développe quand il le faut']];
const SOURCES = [['documents', 'Mes documents'], ['wikis', 'Wikis'], ['livres', 'Livres']];
const EMOJIS = ['🦉', '🤖', '📚', '🧭', '🦊', '🐢', '🛰️', '🕯️', '⚙️', '🧠'];
const RESEAUX = [['disponible', 'ODIN a accès à internet'], ['indisponible', 'ODIN n\'a plus accès à internet'], ['inconnu', 'État inconnu']];

const dateFr = (t) => (t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais');

// Settings of the assistant and state of its index. One password, one profile: everything here is
// shared by the whole household.
export default function Assistant({ initiaux, defauts, prompt: promptInitial, etat: etatInitial }) {
  const [r, setR] = useState(initiaux);
  const [prompt, setPrompt] = useState(promptInitial);
  const [etat, setEtat] = useState(etatInitial);
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);
  const fichier = useRef(null);
  const importation = useRef(null);

  const maj = (champs) => setR((v) => ({ ...v, ...champs }));
  const majPerso = (champs) => setR((v) => ({ ...v, personnalite: { ...v.personnalite, ...champs } }));
  const majSeuil = (source, champ, valeur) => setR((v) => ({ ...v, seuils: { ...v.seuils, [source]: { ...v.seuils[source], [champ]: valeur } } }));

  // State of the index, refreshed while an indexing runs
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
    e?.preventDefault();
    setMessage('');
    setErreur('');
    setOccupe(true);
    try {
      const rep = await fetch('/api/assistant/reglages', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) });
      const corps = await rep.json();
      if (!rep.ok) throw new Error(corps.erreur);
      setR(corps.reglages);
      setPrompt(corps.prompt);
      setMessage(corps.reindexation ? 'Réglages enregistrés. Le modèle d\'embeddings a changé : tout est réindexé.' : 'Réglages enregistrés.');
      if (corps.reindexation) setTimeout(rafraichirEtat, 1500);
    } catch (err) {
      setErreur(err.message || 'Enregistrement impossible');
    } finally {
      setOccupe(false);
    }
  }

  async function changerModeleEmbedding(valeur) {
    if (valeur === r.modeleEmbedding) return;
    if (!confirm(`Changer le modèle d'embeddings pour « ${valeur} » efface l'index et réindexe tous les documents. Continuer ?`)) return;
    maj({ modeleEmbedding: valeur });
  }

  async function envoyerImage(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErreur('');
    try {
      const rep = await fetch('/api/assistant/avatar', { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
      const corps = await rep.json();
      if (!rep.ok) throw new Error(corps.erreur);
      setR(corps.reglages);
      setMessage('Image enregistrée.');
    } catch (err) {
      setErreur(err.message);
    }
  }

  async function retirerImage() {
    const rep = await fetch('/api/assistant/avatar', { method: 'DELETE' });
    const corps = await rep.json();
    setR(corps.reglages);
    if (fichier.current) fichier.current.value = '';
  }

  async function reindexer(complet) {
    if (complet && !confirm('Tout réindexer relit et revectorise chaque document. Continuer ?')) return;
    setMessage('');
    try {
      setEtat(await (await fetch('/api/assistant/index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ complet }) })).json());
      setMessage(complet ? 'Réindexation complète lancée.' : 'Indexation lancée.');
    } catch (err) {
      setErreur('Indexation impossible');
    }
  }

  function exporter() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 1)], { type: 'application/json' }));
    a.download = 'assistant-odin.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importer(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErreur('');
    try {
      const lu = JSON.parse(await f.text());
      setR((v) => ({ ...v, ...lu }));
      setMessage('Configuration chargée : vérifie puis enregistre.');
    } catch {
      setErreur('Fichier JSON illisible');
    } finally {
      if (importation.current) importation.current.value = '';
    }
  }

  const problemes = etat?.problemes || [];

  return (
    <form className="reglages" onSubmit={enregistrer} id="assistant">
      <fieldset>
        <legend>Index des documents</legend>
        <p className="assistant-index">
          <strong>{etat?.documents ?? '–'}</strong> documents · <strong>{etat?.morceaux ?? '–'}</strong> morceaux ·
          dernière indexation {dateFr(etat?.derniereIndexation)}
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
        <div className="choix-emojis">
          {EMOJIS.map((e) => (
            <button type="button" key={e} className={r.avatar === e ? 'choisi' : ''} onClick={() => maj({ avatar: e })}>{e}</button>
          ))}
          <input className="emoji-libre" value={r.avatar === 'image' || EMOJIS.includes(r.avatar) ? '' : r.avatar} onChange={(e) => maj({ avatar: e.target.value.slice(0, 8) })} placeholder="ou le tien" aria-label="Autre emoji" />
          {r.avatar === 'image' && <span className="chat-avatar"><img src="/api/assistant/avatar" alt="" /></span>}
        </div>
        <label className="ligne">
          <span>Image</span>
          <input ref={fichier} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={envoyerImage} />
        </label>
        {r.avatar === 'image' && <button type="button" onClick={retirerImage}>Revenir à un emoji</button>}
        <label className="ligne">
          <span>Couleur</span>
          <input type="color" value={r.couleur} onChange={(e) => maj({ couleur: e.target.value })} />
        </label>
        <label className="ligne">
          <span>Message d'accueil</span>
          <input value={r.accueil} maxLength={300} onChange={(e) => maj({ accueil: e.target.value })} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Personnalité</legend>
        <label className="ligne">
          <span>Ton</span>
          <input value={r.personnalite.ton} maxLength={200} onChange={(e) => majPerso({ ton: e.target.value })} />
        </label>
        <label><input type="checkbox" checked={r.personnalite.tutoiement} onChange={(e) => majPerso({ tutoiement: e.target.checked })} /><span>Tutoiement<small>sinon vouvoiement</small></span></label>
        <label><input type="checkbox" checked={r.personnalite.humour} onChange={(e) => majPerso({ humour: e.target.checked })} /><span>Touches d'humour</span></label>
        {LONGUEURS.map(([v, libelle, aide]) => (
          <label key={v}>
            <input type="radio" name="longueur" checked={r.personnalite.longueur === v} onChange={() => majPerso({ longueur: v })} />
            <span>{libelle}<small>{aide}</small></span>
          </label>
        ))}
        <label className="ligne">
          <span>Consignes libres</span>
          <textarea rows={2} maxLength={1000} value={r.personnalite.consignes} onChange={(e) => majPerso({ consignes: e.target.value })} placeholder="Par exemple : cite toujours la page d'un livre." />
        </label>
        <details className="assistant-prompt">
          <summary>Aperçu du prompt assemblé (le noyau n'est pas modifiable)</summary>
          <pre>{prompt}</pre>
        </details>
        <button type="button" onClick={() => { majPerso(defauts.personnalite); setMessage('Personnalité remise par défaut : enregistre pour confirmer.'); }}>Réinitialiser la personnalité</button>
      </fieldset>

      <fieldset>
        <legend>Quand il ne trouve rien</legend>
        {r.jeNeSaisPas.map((p, i) => (
          <div key={i} className="reglages-ligne-texte">
            <input value={p} maxLength={300} onChange={(e) => setR((v) => ({ ...v, jeNeSaisPas: v.jeNeSaisPas.map((x, j) => (j === i ? e.target.value : x)) }))} />
            <button type="button" onClick={() => setR((v) => ({ ...v, jeNeSaisPas: v.jeNeSaisPas.filter((_, j) => j !== i) }))} aria-label="Retirer">✕</button>
          </div>
        ))}
        <button type="button" onClick={() => setR((v) => ({ ...v, jeNeSaisPas: [...v.jeNeSaisPas, ''] }))}>Ajouter une formulation</button>
        <p className="assistant-aide">Une formulation est tirée au hasard. {'{nom}'} est remplacé par le nom de l'assistant.</p>
      </fieldset>

      <fieldset>
        <legend>Urgences</legend>
        <label className="ligne">
          <span>Numéro</span>
          <input value={r.numeroUrgence} maxLength={20} onChange={(e) => maj({ numeroUrgence: e.target.value })} />
        </label>
        {RESEAUX.map(([cle, libelle]) => (
          <label className="ligne" key={cle}>
            <span>{libelle}</span>
            <textarea rows={2} maxLength={500} value={r.urgences[cle]} onChange={(e) => maj({ urgences: { ...r.urgences, [cle]: e.target.value } })} />
          </label>
        ))}
        <p className="assistant-aide">{'{secours}'} est remplacé par le numéro, {'{nom}'} par le nom de l'assistant.</p>
      </fieldset>

      <details className="assistant-avance">
        <summary>Avancé</summary>
        <fieldset>
          <legend>Modèles</legend>
          <label className="ligne">
            <span>Modèle de langage</span>
            <input value={r.modeleChat} maxLength={100} onChange={(e) => maj({ modeleChat: e.target.value })} />
          </label>
          <label className="ligne">
            <span>Modèle d'embeddings</span>
            <input value={r.modeleEmbedding} maxLength={100} onChange={(e) => changerModeleEmbedding(e.target.value)} />
          </label>
          <p className="assistant-aide">Le modèle doit être installé dans Ollama. Changer les embeddings réindexe tous les documents.</p>
        </fieldset>
        <fieldset>
          <legend>Recherche et réponse</legend>
          <label className="ligne">
            <span>Extraits envoyés</span>
            <input type="number" min={1} max={8} value={r.extraits} onChange={(e) => maj({ extraits: Number(e.target.value) })} />
          </label>
          <label className="ligne">
            <span>Température</span>
            <input type="number" min={0} max={1.5} step={0.1} value={r.temperature} onChange={(e) => maj({ temperature: Number(e.target.value) })} />
          </label>
          {SOURCES.map(([cle, libelle]) => (
            <div className="reglages-seuils" key={cle}>
              <span>{libelle}</span>
              <label>réponse <input type="number" min={0} max={1} step={0.01} value={r.seuils[cle].reponse} onChange={(e) => majSeuil(cle, 'reponse', Number(e.target.value))} /></label>
              <label>proches <input type="number" min={0} max={1} step={0.01} value={r.seuils[cle].proches} onChange={(e) => majSeuil(cle, 'proches', Number(e.target.value))} /></label>
            </div>
          ))}
          <label><input type="checkbox" checked={r.memoire} onChange={(e) => maj({ memoire: e.target.checked })} /><span>Mémoire courte<small>le dernier échange sert à comprendre les questions de suivi</small></span></label>
          <label><input type="checkbox" checked={r.debug} onChange={(e) => maj({ debug: e.target.checked })} /><span>Mode debug<small>extraits bruts et scores sous chaque réponse</small></span></label>
        </fieldset>
        <fieldset>
          <legend>Configuration</legend>
          <div className="reglages-actions">
            <button type="button" onClick={exporter}>Exporter en JSON</button>
            <button type="button" onClick={() => importation.current?.click()}>Importer…</button>
            <input ref={importation} type="file" accept="application/json,.json" hidden onChange={importer} />
          </div>
        </fieldset>
      </details>

      <div className="reglages-actions">
        <button type="submit" disabled={occupe}>{occupe ? 'Enregistrement…' : 'Enregistrer'}</button>
        {message && <span className="assistant-message">{message}</span>}
        {erreur && <span className="erreur">{erreur}</span>}
      </div>
    </form>
  );
}

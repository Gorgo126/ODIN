'use client';
import { useEffect, useRef, useState } from 'react';
import Sprite from './Sprite';

// Whole assistant page: fixed layout (only the thread scrolls), history panel on the left, and the
// conversation itself. The panel slides over the thread on a narrow screen.

const ETATS = { comprehension: 'compréhension…', recherche: 'recherche…', redaction: 'rédaction…' };
const Avatar = ({ avatar }) => <span className="chat-avatar"><Sprite nom={avatar} /></span>;

const jour = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const heure = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dateCourte = (t) => {
  const d = new Date(t);
  const aujourdhui = new Date().toDateString() === d.toDateString();
  return aujourdhui ? heure(t) : jour(t);
};

// References [n] of the answer, as small links to their source
function Texte({ texte, renvois }) {
  return (
    <p className="chat-texte">
      {texte.split(/(\[\d+\])/g).map((m, i) => {
        const n = m.match(/^\[(\d+)\]$/)?.[1];
        const r = n && renvois?.[n];
        return r ? <a key={i} href={r.lien} className="chat-renvoi" title={r.libelle}>{n}</a> : m;
      })}
    </p>
  );
}

function Reponse({ r, avatar, nom }) {
  const renvois = r.fin?.renvois || Object.fromEntries((r.fin?.sources || []).map((s) => [s.n, s]));
  return (
    <div className="chat-reponse">
      <Avatar avatar={avatar} />
      <div className="chat-bulle">
        {!r.texte && !r.erreur && <p className="chat-etat">{ETATS[r.etat] || `${nom} réfléchit…`}</p>}
        {r.texte && <Texte texte={r.texte} renvois={renvois} />}
        {r.erreur && <p className="erreur">{r.erreur}</p>}
        {r.fin?.sources?.length > 0 && (
          <p className="chat-sources">
            Sources :{' '}
            {r.fin.sources.map((s, i) => (
              <span key={s.n}>{i > 0 && ' · '}<a href={s.lien} className="chat-renvoi">{s.n}</a> <a href={s.lien}>{s.libelle}</a></span>
            ))}
          </p>
        )}
        {r.fin?.documents?.length > 0 && (
          <div className="grille chat-documents">
            {r.fin.documents.map((d) => (
              <a key={d.lien} href={d.lien} className="carte"><strong>{d.titre}</strong><em>{d.libelle}</em></a>
            ))}
          </div>
        )}
        {r.fin?.debug && (
          <details className="chat-debug">
            <summary>
              Debug : issue {r.fin.issue}, cosinus {Object.entries(r.fin.meilleurs || {}).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', ') || '–'}
              {', '}{r.fin.durees?.premierMot} ms / {r.fin.durees?.total} ms
            </summary>
            <pre>{JSON.stringify({ comprehension: r.fin.comprehension, durees: r.fin.durees, ...r.fin.debug }, null, 1)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

export default function Espace({ nom, avatar, couleur, accueil, memoire, debug, conversations = [] }) {
  const [liste, setListe] = useState(conversations);
  const [courante, setCourante] = useState(null);
  const [echanges, setEchanges] = useState([]);
  const [question, setQuestion] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [ouvert, setOuvert] = useState(false);
  const champ = useRef(null);
  const bas = useRef(null);

  useEffect(() => { bas.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [echanges]);

  function nouvelle() {
    setCourante(null);
    setEchanges([]);
    setOuvert(false);
    champ.current?.focus();
  }

  async function ouvrir(id) {
    setOuvert(false);
    try {
      const c = await (await fetch(`/api/assistant/conversations/${id}`)).json();
      const lus = [];
      for (const m of c.messages || []) {
        if (m.role === 'question') lus.push({ q: m.texte, r: { texte: '' } });
        else if (lus.length) lus.at(-1).r = { texte: m.texte, fin: { sources: m.sources, issue: m.issue } };
      }
      setEchanges(lus);
      setCourante(c.id);
    } catch {
      setEchanges([{ q: '', r: { erreur: 'Conversation illisible' } }]);
    }
  }

  async function renommer(c) {
    const titre = prompt('Nouveau titre', c.titre);
    if (!titre) return;
    setListe(await (await fetch(`/api/assistant/conversations/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titre }) })).json());
  }

  async function supprimer(c) {
    if (!confirm(`Supprimer « ${c.titre} » ?`)) return;
    setListe(await (await fetch(`/api/assistant/conversations/${c.id}`, { method: 'DELETE' })).json());
    if (courante === c.id) nouvelle();
  }

  async function viderTout() {
    if (!confirm('Supprimer TOUTES les conversations ? C\'est définitif.')) return;
    setListe(await (await fetch('/api/assistant/conversations', { method: 'DELETE' })).json());
    nouvelle();
  }

  async function envoyer(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q || occupe) return;
    const precedent = echanges.at(-1);
    // Short memory: only the last exchange goes to the model, however long the conversation is
    const historique = memoire && precedent?.r.fin ? [{ question: precedent.q, reponse: precedent.r.texte }] : [];
    const i = echanges.length;
    const maj = (f) => setEchanges((l) => l.map((x, k) => (k === i ? { ...x, r: f(x.r) } : x)));
    setEchanges((l) => [...l, { q, r: { texte: '' } }]);
    setQuestion('');
    setOccupe(true);
    try {
      const rep = await fetch('/api/assistant/question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, historique, debug, conversation: courante })
      });
      if (!rep.ok) throw new Error((await rep.json().catch(() => ({}))).erreur || `Erreur ${rep.status}`);
      const lecteur = rep.body.getReader();
      const decodeur = new TextDecoder();
      let reste = '';
      for (;;) {
        const { value, done } = await lecteur.read();
        if (done) break;
        reste += decodeur.decode(value, { stream: true });
        const lignes = reste.split('\n');
        reste = lignes.pop();
        for (const l of lignes.filter(Boolean)) {
          const ev = JSON.parse(l);
          if (ev.type === 'etat') maj((r) => ({ ...r, etat: ev.etat }));
          else if (ev.type === 'texte') maj((r) => ({ ...r, texte: r.texte + ev.texte }));
          // The final text carries the references renumbered by source
          else if (ev.type === 'fin') maj((r) => ({ ...r, fin: ev, texte: ev.texte ?? r.texte }));
          else if (ev.type === 'erreur') maj((r) => ({ ...r, erreur: ev.message }));
          else if (ev.type === 'conversation') {
            setCourante(ev.id);
            setListe((l) => [{ id: ev.id, titre: ev.titre, modifie: ev.modifie }, ...l.filter((c) => c.id !== ev.id)]);
          }
        }
      }
    } catch (err) {
      maj((r) => ({ ...r, erreur: err.message }));
    } finally {
      setOccupe(false);
      champ.current?.focus();
    }
  }

  return (
    <div className="assistant-app" style={{ '--or': couleur }}>
      <nav className="barre assistant-barre">
        <button type="button" className="assistant-bascule" onClick={() => setOuvert((o) => !o)} aria-label="Conversations">☰</button>
        <a href="/" className="accueil">ODIN</a>
        <span className="sep">/</span>
        <span className="chat-avatar petit"><Sprite nom={avatar} /></span>
        <span className="titre">{nom}</span>
        <a className="externe" href="/configuration#assistant">Réglages</a>
      </nav>

      <div className="assistant-corps">
        <aside className={`assistant-panneau${ouvert ? ' ouvert' : ''}`}>
          <button type="button" className="assistant-nouvelle" onClick={nouvelle}>+ Nouvelle conversation</button>
          <ul className="assistant-liste">
            {liste.map((c) => (
              <li key={c.id} className={c.id === courante ? 'actif' : ''}>
                <button type="button" className="assistant-titre" onClick={() => ouvrir(c.id)}>
                  <strong>{c.titre}</strong>
                  <em>{dateCourte(c.modifie)}</em>
                </button>
                <span className="assistant-actions">
                  <button type="button" onClick={() => renommer(c)} title="Renommer" aria-label="Renommer">✎</button>
                  <button type="button" onClick={() => supprimer(c)} title="Supprimer" aria-label="Supprimer">✕</button>
                </span>
              </li>
            ))}
            {!liste.length && <li className="vide">Aucune conversation.</li>}
          </ul>
          <button type="button" className="assistant-vider" onClick={viderTout} disabled={!liste.length}>Supprimer tout l'historique</button>
        </aside>
        {ouvert && <button type="button" className="assistant-voile" onClick={() => setOuvert(false)} aria-label="Fermer les conversations" />}

        <section className="chat">
          <div className="chat-fil">
            {!echanges.length && (
              <div className="chat-reponse chat-accueil">
                <Avatar avatar={avatar} />
                <div className="chat-bulle"><p className="chat-texte">{accueil}</p></div>
              </div>
            )}
            {echanges.map((x, i) => (
              <div key={i} className="chat-echange">
                {x.q && <p className="chat-question">{x.q}</p>}
                <Reponse r={x.r} avatar={avatar} nom={nom} />
              </div>
            ))}
            <div ref={bas} />
          </div>
          <form className="chat-saisie" onSubmit={envoyer}>
            <input ref={champ} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`Pose ta question à ${nom}…`} aria-label="Question" autoFocus />
            <button type="submit" disabled={occupe}>{occupe ? '…' : 'Envoyer'}</button>
          </form>
        </section>
      </div>
    </div>
  );
}

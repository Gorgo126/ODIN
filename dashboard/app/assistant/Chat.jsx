'use client';
import { useEffect, useRef, useState } from 'react';

const ETATS = { comprehension: 'compréhension…', recherche: 'recherche…', redaction: 'rédaction…' };

const Avatar = ({ avatar }) => (
  <span className="chat-avatar">{avatar === 'image' ? <img src="/api/assistant/avatar" alt="" /> : avatar}</span>
);

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
  return (
    <div className="chat-reponse">
      <Avatar avatar={avatar} />
      <div className="chat-bulle">
        {!r.texte && !r.erreur && <p className="chat-etat">{ETATS[r.etat] || `${nom} réfléchit…`}</p>}
        {r.texte && <Texte texte={r.texte} renvois={r.fin?.renvois} />}
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

export default function Chat({ nom, avatar, accueil, memoire }) {
  const [echanges, setEchanges] = useState([]);
  const [question, setQuestion] = useState('');
  const [occupe, setOccupe] = useState(false);
  const champ = useRef(null);
  const bas = useRef(null);

  useEffect(() => { bas.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [echanges]);

  async function envoyer(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q || occupe) return;
    const precedent = echanges.at(-1);
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
        body: JSON.stringify({ question: q, historique })
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
    <section className="chat">
      {!echanges.length && (
        <div className="chat-reponse chat-accueil">
          <Avatar avatar={avatar} />
          <div className="chat-bulle"><p className="chat-texte">{accueil}</p></div>
        </div>
      )}
      {echanges.map((x, i) => (
        <div key={i} className="chat-echange">
          <p className="chat-question">{x.q}</p>
          <Reponse r={x.r} avatar={avatar} nom={nom} />
        </div>
      ))}
      <div ref={bas} />
      <form className="recherche chat-saisie" onSubmit={envoyer}>
        <input ref={champ} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`Pose ta question à ${nom}…`} aria-label="Question" autoFocus />
        <button type="submit" disabled={occupe}>{occupe ? '…' : 'Envoyer'}</button>
      </form>
    </section>
  );
}

'use client';
import { useRef, useState } from 'react';

const ETATS = { comprehension: 'compréhension…', recherche: 'recherche…', redaction: 'rédaction…' };

// Citations [n] of the answer as small links to their source
function Texte({ texte, renvois }) {
  const morceaux = texte.split(/(\[\d+\])/g);
  return (
    <p className="chat-texte">
      {morceaux.map((m, i) => {
        const n = m.match(/^\[(\d+)\]$/)?.[1];
        const r = n && renvois?.[n];
        return r ? <a key={i} href={r.lien} className="chat-renvoi" title={r.libelle}>{n}</a> : m;
      })}
    </p>
  );
}

function Reponse({ r }) {
  return (
    <div className="chat-reponse">
      {r.etat && !r.texte && <p className="chat-etat">{ETATS[r.etat]}</p>}
      {r.texte && <Texte texte={r.texte} renvois={r.fin?.renvois} />}
      {r.erreur && <p className="erreur">{r.erreur}</p>}
      {r.fin?.sources?.length > 0 && (
        <p className="chat-sources">
          Sources :{' '}
          {r.fin.sources.map((s, i) => (
            <span key={s.n}>{i > 0 && ' · '}<a href={s.lien} className="chat-renvoi">{s.n}</a> {s.libelle}</span>
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
          <summary>Debug : issue {r.fin.issue}, cosinus max {r.fin.meilleurCosinus?.toFixed(3)}, {r.fin.durees.total} ms</summary>
          <pre>{JSON.stringify(r.fin.debug, null, 1)}</pre>
        </details>
      )}
    </div>
  );
}

export default function Chat({ nom, memoire }) {
  const [echanges, setEchanges] = useState([]);
  const [question, setQuestion] = useState('');
  const [occupe, setOccupe] = useState(false);
  const champ = useRef(null);

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
      {echanges.map((x, i) => (
        <div key={i} className="chat-echange">
          <p className="chat-question">{x.q}</p>
          <Reponse r={x.r} />
        </div>
      ))}
      <form className="recherche" onSubmit={envoyer}>
        <input ref={champ} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`Pose ta question à ${nom}…`} aria-label="Question" autoFocus />
        <button type="submit" disabled={occupe}>Envoyer</button>
      </form>
    </section>
  );
}

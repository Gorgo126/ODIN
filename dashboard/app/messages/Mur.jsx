'use client';
import { useEffect, useRef, useState } from 'react';

const INTERVALLE = 5000;
const CLE_PSEUDO = 'odin-pseudo';

// Relative time from the server clock: « decalage » is the server time minus the phone time at the
// last answer, so a phone set to the wrong time still shows the right delay
function depuis(date, maintenant) {
  const s = Math.max(0, Math.round((maintenant - date) / 1000));
  if (s < 60) return "à l'instant";
  const min = Math.floor(s / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  return `il y a ${j} j`;
}

const absolue = (date) => new Date(date).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });

const lirePseudo = () => { try { return localStorage.getItem(CLE_PSEUDO) || ''; } catch { return ''; } };
const garderPseudo = (p) => { try { localStorage.setItem(CLE_PSEUDO, p); } catch {} };

export default function Mur({ admin, texteMax, pseudoMax }) {
  const [messages, setMessages] = useState(null);
  const [pseudo, setPseudo] = useState('');
  const [texte, setTexte] = useState('');
  const [erreur, setErreur] = useState(null);
  const [envoi, setEnvoi] = useState(false);
  const [injoignable, setInjoignable] = useState(false);
  const [, setTic] = useState(0);
  const suivi = useRef({ dernier: null, generation: null, decalage: 0 });

  useEffect(() => { setPseudo(lirePseudo()); }, []);

  // New messages merged by id, most recent first
  function recevoir(d) {
    const s = suivi.current;
    s.decalage = d.maintenant - Date.now();
    s.generation = d.generation;
    setMessages((avant) => {
      const liste = d.complet || !avant ? d.messages : [...d.messages, ...avant.filter((m) => !d.messages.some((n) => n.id === m.id))];
      liste.sort((a, b) => b.id - a.id);
      s.dernier = liste.length ? liste[0].id : 0;
      return liste;
    });
    setInjoignable(false);
  }

  async function charger() {
    const s = suivi.current;
    const q = s.dernier !== null && s.generation !== null ? `?since=${s.dernier}&gen=${s.generation}` : '';
    try {
      const r = await fetch('/api/messages' + q, { cache: 'no-store' });
      if (!r.ok) throw new Error();
      recevoir(await r.json());
    } catch {
      setInjoignable(true);
    }
    setTic((t) => t + 1);
  }

  useEffect(() => {
    charger();
    const minuterie = setInterval(() => { if (!document.hidden) charger(); }, INTERVALLE);
    const visible = () => { if (!document.hidden) charger(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(minuterie); document.removeEventListener('visibilitychange', visible); };
  }, []);

  async function envoyer(ev) {
    ev.preventDefault();
    if (envoi) return;
    setErreur(null);
    setEnvoi(true);
    garderPseudo(pseudo.trim());
    try {
      const r = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pseudo, texte })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erreur || 'Envoi impossible.');
      setTexte('');
      await charger();
    } catch (e) {
      setErreur(e.message === 'Failed to fetch' ? 'ODIN injoignable : message non envoyé.' : e.message);
    } finally {
      setEnvoi(false);
    }
  }

  async function effacer(m) {
    if (!confirm(`Supprimer le message de ${m.pseudo} ?`)) return;
    const r = await fetch(`/api/messages/${m.id}`, { method: 'DELETE' }).catch(() => null);
    if (!r || (!r.ok && r.status !== 404)) { setErreur('Suppression impossible.'); return; }
    await charger();
  }

  const restant = texteMax - Array.from(texte).length;
  const maintenant = Date.now() + suivi.current.decalage;

  return (
    <>
      <form className="mur-formulaire" onSubmit={envoyer}>
        <label>
          <span>Pseudo</span>
          <input value={pseudo} onChange={(e) => setPseudo(e.target.value)} maxLength={pseudoMax} required autoComplete="nickname" placeholder="Votre nom" />
        </label>
        <label>
          <span>Message</span>
          <textarea value={texte} onChange={(e) => setTexte(e.target.value)} rows={3} required placeholder="Parti chercher de l'eau, retour 16 h" />
        </label>
        <div className="mur-envoi">
          <small className={restant < 0 ? 'mur-trop' : undefined}>{restant} caractères restants</small>
          <button type="submit" disabled={envoi || restant < 0 || !texte.trim() || !pseudo.trim()}>{envoi ? 'Envoi…' : 'Envoyer'}</button>
        </div>
        {erreur && <p className="mur-erreur" role="alert">{erreur}</p>}
      </form>

      {injoignable && <p className="mur-erreur">ODIN injoignable : nouvel essai toutes les 5 secondes.</p>}

      {messages === null ? (
        <p className="mur-vide">Chargement…</p>
      ) : messages.length === 0 ? (
        <p className="mur-vide">Aucun message pour l'instant.</p>
      ) : (
        <ol className="mur-fil">
          {messages.map((m) => (
            <li key={m.id} className="mur-message">
              <div className="mur-tete">
                <strong>{m.pseudo}</strong>
                <time dateTime={new Date(m.date).toISOString()} title={absolue(m.date)}>{depuis(m.date, maintenant)}</time>
                {admin && <button type="button" className="mur-supprimer" onClick={() => effacer(m)} aria-label={`Supprimer le message de ${m.pseudo}`}>Supprimer</button>}
              </div>
              <p>{m.texte}</p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

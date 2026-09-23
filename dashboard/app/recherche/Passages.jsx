'use client';

import { useEffect, useState } from 'react';
import { normaliser } from '../../lib/normalisation.mjs';
import Chargement from './Chargement';

// Advanced search, above the keyword results: the best passages of every source, grouped by
// document. Fetched after the page is shown (the embedding model may take a few seconds on CPU);
// onEtat(true | false) tells the page when it runs, so the keyword results wait for it.

// Query words highlighted: same matching as the search (accents and case ignored, prefixes)
function Surligne({ texte, mots }) {
  return texte.split(/([\p{L}\p{N}]+)/u).map((m, i) => {
    if (i % 2 === 1) {
      const n = normaliser(m);
      if (mots.some((q) => n === q || (q.length >= 4 && n.startsWith(q)))) return <mark key={i}>{m}</mark>;
    }
    return m;
  });
}

const chiffre = (v, k = 2) => (typeof v === 'number' ? v.toFixed(k) : '–');

function Debug({ d }) {
  return (
    <small className="passage-debug">
      cos {chiffre(d.cosinus, 3)} · couverture {chiffre(d.couverture)} · bm25 {chiffre(d.bm25)} (brut {chiffre(d.bm25Brut)})
      {d.rangVecteur || d.rangMots ? ` · rangs vecteur ${d.rangVecteur ?? '–'} mots ${d.rangMots ?? '–'}` : ''}
      {d.regles?.length ? ` · ${d.regles.join(', ')}` : ''}
    </small>
  );
}

function Groupe({ g, mots }) {
  return (
    <article className={`carte passage-groupe${g.origine === 'livre' ? ' passage-livre' : ''}`}>
      <span className="livre-badges">
        <span className={`badge${g.origine === 'wiki' ? ' badge-discret' : ''}`}>{g.etiquette}</span>
        {g.guide && <span className="badge">Guide médical</span>}
      </span>
      <a href={g.lien} className="passage-titre"><strong>{g.titre}</strong></a>
      {g.origine === 'wiki' && g.source && <em>{g.source}</em>}
      {g.passages.map((p, i) => (
        <a key={i} href={p.lien} className="passage">
          {(p.page || p.section) && <span className="passage-ou">{[p.page && `p. ${p.page}`, p.section].filter(Boolean).join(' · ')}</span>}
          <p><Surligne texte={p.texte} mots={mots} /></p>
          {p.debug && <Debug d={p.debug} />}
        </a>
      ))}
    </article>
  );
}

export default function Passages({ question, debug = false, onEtat }) {
  const [etat, setEtat] = useState({ chargement: true });

  useEffect(() => {
    const ctrl = new AbortController();
    const debut = Date.now();
    setEtat({ chargement: true });
    onEtat?.(true);
    fetch(`/api/recherche?q=${encodeURIComponent(question)}${debug ? '&debug=1' : ''}`, { signal: ctrl.signal, cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({ erreur: r.status === 401 ? 'Session expirée : reconnectez-vous.' : `Réponse inattendue (${r.status})` }));
        setEtat(r.ok && !j.erreur ? { r: j, duree: Date.now() - debut } : { erreur: j.erreur || `Erreur ${r.status}` });
      })
      .catch((e) => { if (!ctrl.signal.aborted) setEtat({ erreur: `Recherche impossible : ${e.message}` }); })
      .finally(() => { if (!ctrl.signal.aborted) onEtat?.(false); });
    return () => ctrl.abort();
  }, [question, debug, onEtat]);

  if (etat.chargement) return <Chargement />;
  if (etat.erreur) return <section className="bloc-resultats"><p className="erreur">{etat.erreur}</p></section>;

  const { r, duree } = etat;
  const rien = !r.forts.length && !r.proches.length;
  return (
    <section className="bloc-resultats passages">
      {r.bandeau && <p className="bandeau-sante bandeau-urgence" role="alert">{r.bandeau}</p>}
      <h2>{r.forts.length ? 'Meilleurs passages' : 'Passages les plus proches'}</h2>
      <p className="compte">
        {rien ? 'Aucun passage ne répond clairement à cette question : voyez les résultats par mots-clés ci-dessous.'
          : `${r.forts.length + r.proches.length} document${r.forts.length + r.proches.length > 1 ? 's' : ''}`}
        {` · ${(duree / 1000).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} s`}
      </p>
      {!r.vecteurs && <p className="passages-note">Moteur de similarité indisponible : classement par mots-clés seulement.</p>}
      {r.forts.map((g) => <Groupe key={g.cle} g={g} mots={r.mots} />)}
      {r.forts.length > 0 && r.proches.length > 0 && (
        <details className="passages-proches">
          <summary>Pistes plus éloignées ({r.proches.length})</summary>
          {r.proches.map((g) => <Groupe key={g.cle} g={g} mots={r.mots} />)}
        </details>
      )}
      {!r.forts.length && r.proches.map((g) => <Groupe key={g.cle} g={g} mots={r.mots} />)}
      {r.ecartes?.length > 0 && (
        <details className="passages-proches">
          <summary>Écartés, sous les seuils ({r.ecartes.length})</summary>
          <ul className="passages-debug">
            {r.ecartes.map((e, i) => (
              <li key={i}>{e.origine} · {e.titre}{e.page ? `, p. ${e.page}` : ''}{e.section ? ` · ${e.section}` : ''} — cos {chiffre(e.cosinus, 3)} · couverture {chiffre(e.couverture)} · bm25 {chiffre(e.bm25)}{e.regles?.length ? ` · ${e.regles.join(', ')}` : ''}</li>
            ))}
          </ul>
        </details>
      )}
      {r.debug && (
        <pre className="passages-debug">
          {`terme : ${r.debug.terme?.terme ?? 'aucun'} (${r.debug.terme?.source})\nmeilleurs : ${JSON.stringify(r.debug.meilleurs)}\nseuils : ${JSON.stringify(r.debug.seuils)}\ndurées : ${JSON.stringify(r.durees)}`}
        </pre>
      )}
    </section>
  );
}

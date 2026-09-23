'use client';

import { useEffect, useState } from 'react';
import Chargement from './Chargement';
import Groupe, { chiffre } from './Groupe';

// Advanced search, above the keyword results: the best passages of every source, grouped by
// document. Fetched after the page is shown (the embedding model may take a few seconds on CPU);
// onEtat(true | false) tells the page when it runs, so the keyword results wait for it.

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
          {`compris : ${r.debug.comprehension?.entrees?.join(' ; ') || 'rien dans la table'}\nrequêtes : ${r.debug.requetes?.join(' | ')}\nvecteur : ${r.debug.texteVecteur}\nterme : ${r.debug.terme?.terme ?? 'aucun'} (${r.debug.terme?.source})\nmeilleurs : ${JSON.stringify(r.debug.meilleurs)}\nseuils : ${JSON.stringify(r.debug.seuils)}\ndurées : ${JSON.stringify(r.durees)}`}
        </pre>
      )}
    </section>
  );
}

'use client';

import { normaliser } from '../../lib/normalisation.mjs';

// One document of the advanced search with its passages (words highlighted, page or section, link).
// Shared by the search page and the assistant.

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

export const chiffre = (v, k = 2) => (typeof v === 'number' ? v.toFixed(k) : '–');

function Debug({ d }) {
  return (
    <small className="passage-debug">
      cos {chiffre(d.cosinus, 3)} · couverture {chiffre(d.couverture)} · bm25 {chiffre(d.bm25)} (brut {chiffre(d.bm25Brut)})
      {d.rangVecteur || d.rangMots ? ` · rangs vecteur ${d.rangVecteur ?? '–'} mots ${d.rangMots ?? '–'}` : ''}
      {d.regles?.length ? ` · ${d.regles.join(', ')}` : ''}
    </small>
  );
}

export default function Groupe({ g, mots }) {
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

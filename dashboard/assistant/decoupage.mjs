// Splits the blocks of a document into chunks of about `cible` tokens, cut at paragraphs and
// headings, each one starting with the last `chevauchement` tokens of the one before (never across
// a heading). Tokens are estimated at 4 characters each: close enough for French, and far below
// the context of the embedding models.

export const jetons = (s) => Math.ceil(s.length / 4);

// A paragraph longer than a chunk is cut at sentences, and a sentence too long at words
function pieces(texte, max) {
  if (jetons(texte) <= max) return [texte];
  const res = [];
  let courant = '';
  const ajouter = (bout) => {
    if (courant && jetons(courant + ' ' + bout) > max) { res.push(courant); courant = ''; }
    courant = courant ? `${courant} ${bout}` : bout;
  };
  for (const phrase of texte.match(/[^.!?…]+[.!?…]+["»”)]*\s*|[^.!?…]+$/g) || [texte]) {
    const p = phrase.trim();
    if (jetons(p) <= max) ajouter(p);
    else for (const mot of p.split(/\s+/)) ajouter(mot);
  }
  if (courant) res.push(courant);
  return res;
}

// End of a text of about n tokens, starting on a word
function fin(texte, n) {
  if (jetons(texte) <= n) return texte;
  const coupe = texte.slice(-n * 4);
  const espace = coupe.indexOf(' ');
  return espace === -1 ? coupe : coupe.slice(espace + 1);
}

export function decouper(blocs, { cible = 400, chevauchement = 55 } = {}) {
  const morceaux = [];
  let section = '';
  let reprise = '';   // overlap carried from the previous chunk
  let nouveau = [];   // paragraphs of the current chunk not yet in any chunk
  let debut = null;   // page and section where the new content starts

  const taille = () => jetons([reprise, ...nouveau.map((p) => p.texte)].join('\n\n'));
  const clore = (garderReprise) => {
    if (!nouveau.length) return;
    const texte = [reprise, ...nouveau.map((p) => p.texte)].filter(Boolean).join('\n\n');
    morceaux.push({ texte, page: debut.page ?? null, section: debut.section || null });
    reprise = garderReprise ? fin(nouveau.map((p) => p.texte).join('\n\n'), chevauchement) : '';
    nouveau = [];
    debut = null;
  };

  for (const b of blocs) {
    if (b.titre) {
      // A heading starts a new chunk, unless the current one is still very short
      // (then the heading stays in its text)
      if (taille() >= cible / 4) clore(false);
      else if (nouveau.length) nouveau.push({ texte: b.texte });
      else reprise = '';
      section = b.texte;
      continue;
    }
    for (const texte of pieces(b.texte, cible - chevauchement)) {
      if (nouveau.length && taille() + jetons(texte) > cible) clore(true);
      if (!debut) debut = { page: b.page, section };
      nouveau.push({ texte });
    }
  }
  clore(false);
  return morceaux;
}

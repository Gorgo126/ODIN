import { demander, reglagesAssistant, reseauAssistant } from '../../../lib/assistant.mjs';
import { grouper } from '../../../assistant/passages.mjs';
import { signeDeGravite } from '../../../assistant/securite.mjs';
import { motsUtiles } from '../../../assistant/contexte.mjs';
import { normaliser } from '../../../lib/normalisation.mjs';

export const dynamic = 'force-dynamic';

// Advanced search: a question in plain language, the best passages of every source (personal
// documents, wikis, books), grouped by document. No language model: nothing is written.
// ?debug=1 adds the scores and the rules of each passage.
const EXTRAITS = 16;

export async function GET(req) {
  const p = new URL(req.url).searchParams;
  const question = (p.get('q') || '').trim().slice(0, 500);
  if (!question) return Response.json({ erreur: 'Question vide' }, { status: 400 });
  const debug = p.get('debug') === '1';
  const reglages = reglagesAssistant();
  // Signs of gravity are found by fixed rules on the question; the network state is asked for at
  // once, in parallel with the search (it never waits for a test)
  const urgence = signeDeGravite(question);
  const reseau = urgence ? reseauAssistant() : null;
  try {
    // Kiwix looks for all the words of a query together: « comment soigner une brûlure » finds
    // nothing useful, « brûlure » finds the article. The meaningful words also go alone (the longest
    // three). No main term is proposed: the index picks the rarest word of the question itself.
    // Words kept as typed: Kiwix does not ignore accents (« brulure » finds nothing)
    const utiles = new Set(motsUtiles(question));
    const seuls = [...new Set(question.split(/[^\p{L}\p{N}]+/u).filter((m) => m.length >= 4 && utiles.has(normaliser(m))))]
      .sort((a, b) => b.length - a.length).slice(0, 3);
    const r = await demander('rechercher', { question, n: EXTRAITS, sources: ['documents', 'wikis', 'livres'], requetes: [question, ...seuls], terme: null });
    const g = grouper(r, question, reglages, { urgence, debug });
    return Response.json({
      question,
      ...g,
      vecteurs: r.vecteurs,
      bandeau: urgence ? reglages.bandeauUrgence[await reseau] || reglages.bandeauUrgence.inconnu : null,
      durees: r.durees,
      ...(debug ? { debug: { terme: r.terme, meilleurs: r.meilleurs, seuils: reglages.seuils, couverture: reglages.couverture } } : {})
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ erreur: `Recherche impossible : ${e.message}` }, { status: 503 });
  }
}

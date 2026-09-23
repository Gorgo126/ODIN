import { demander, reglagesAssistant, reseauAssistant } from '../../../lib/assistant.mjs';
import { grouper } from '../../../assistant/passages.mjs';
import { signeDeGravite } from '../../../assistant/securite.mjs';

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
    const r = await demander('rechercher', { question, n: EXTRAITS, sources: ['documents', 'wikis', 'livres'], requetes: [question] });
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

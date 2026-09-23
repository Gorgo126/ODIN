import { demander, reglagesAssistant, reseauAssistant } from '../../../lib/assistant.mjs';
import { chercher } from '../../../assistant/recherche-avancee.mjs';

export const dynamic = 'force-dynamic';

// Advanced search: a question in plain language, the best passages of every source (personal
// documents, wikis, books), grouped by document. No language model: nothing is written.
// ?debug=1 adds the understanding, the scores and the rules of each passage.
export async function GET(req) {
  const p = new URL(req.url).searchParams;
  const question = (p.get('q') || '').trim().slice(0, 500);
  if (!question) return Response.json({ erreur: 'Question vide' }, { status: 400 });
  try {
    const resultat = await chercher({
      question,
      reglages: reglagesAssistant(),
      reseau: reseauAssistant,
      debug: p.get('debug') === '1',
      rechercher: (q, options) => demander('rechercher', { ...options, question: q })
    });
    return Response.json(resultat, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ erreur: `Recherche impossible : ${e.message}` }, { status: 503 });
  }
}

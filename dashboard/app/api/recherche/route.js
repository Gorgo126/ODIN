import { demander, reglagesAssistant, reseauAssistant } from '../../../lib/assistant.mjs';
import { chercher } from '../../../assistant/recherche-avancee.mjs';

export const dynamic = 'force-dynamic';

// Advanced search: a question in plain language, the best passages of every source (personal
// documents, wikis, books), grouped by document. No language model: nothing is written.
// ?debug=1 adds the understanding, the scores and the rules of each passage; with &quota=0, the wiki
// source runs without its per-pack quota (measures before/after).
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
      // Comparison only (?debug=1&quota=0): the wiki source without its per-pack quota
      quota: !(p.get('debug') === '1' && p.get('quota') === '0'),
      rechercher: (q, options) => demander('rechercher', { ...options, question: q })
    });
    return Response.json(resultat, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ erreur: `Recherche impossible : ${e.message}` }, { status: 503 });
  }
}

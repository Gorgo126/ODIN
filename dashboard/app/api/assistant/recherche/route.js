import { demander } from '../../../../lib/assistant.mjs';

export const dynamic = 'force-dynamic';

// Hybrid search in the personal documents (used by the chat from lot 3; readable as JSON for tests)
export async function GET(req) {
  const p = new URL(req.url).searchParams;
  const question = (p.get('q') || '').trim().slice(0, 500);
  if (!question) return Response.json({ erreur: 'Question vide' }, { status: 400 });
  const n = Math.min(Math.max(parseInt(p.get('n'), 10) || 4, 1), 20);
  try {
    return Response.json(await demander('rechercher', { question, n }));
  } catch (e) {
    return Response.json({ erreur: e.message }, { status: 503 });
  }
}

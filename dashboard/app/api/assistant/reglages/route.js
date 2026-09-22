import { reglagesAssistant, ecrireReglagesAssistant } from '../../../../lib/assistant.mjs';
import { DEFAUTS } from '../../../../assistant/reglages.mjs';

export const dynamic = 'force-dynamic';

// Settings of the assistant, with the defaults (« Réinitialiser »)
export async function GET() {
  return Response.json({ reglages: reglagesAssistant(), defauts: DEFAUTS });
}

// Saving. Missing fields keep their value; an invalid one goes back to its default.
export async function PUT(req) {
  const corps = await req.json().catch(() => null);
  if (!corps || typeof corps !== 'object') return Response.json({ erreur: 'Réglages invalides' }, { status: 400 });
  try {
    const { reglages } = await ecrireReglagesAssistant(corps);
    return Response.json({ reglages });
  } catch (e) {
    return Response.json({ erreur: e.message }, { status: 500 });
  }
}

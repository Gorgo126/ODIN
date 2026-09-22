import { reglagesAssistant, ecrireReglagesAssistant } from '../../../../lib/assistant.mjs';
import { DEFAUTS } from '../../../../assistant/reglages.mjs';
import { promptSysteme } from '../../../../assistant/prompt.mjs';

export const dynamic = 'force-dynamic';

// Settings of the assistant, with the defaults (« Réinitialiser ») and the assembled system prompt
export async function GET() {
  const reglages = reglagesAssistant();
  return Response.json({ reglages, defauts: DEFAUTS, prompt: promptSysteme(reglages) });
}

// Saving. Missing fields keep their value; an invalid one goes back to its default.
export async function PUT(req) {
  const corps = await req.json().catch(() => null);
  if (!corps || typeof corps !== 'object') return Response.json({ erreur: 'Réglages invalides' }, { status: 400 });
  try {
    const { reglages, redemarre, reindexation } = await ecrireReglagesAssistant(corps);
    return Response.json({ reglages, redemarre, reindexation, prompt: promptSysteme(reglages) });
  } catch (e) {
    return Response.json({ erreur: e.message }, { status: 500 });
  }
}

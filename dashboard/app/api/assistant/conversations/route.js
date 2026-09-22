import { demander } from '../../../../lib/assistant.mjs';

export const dynamic = 'force-dynamic';

const erreur = (e) => Response.json({ erreur: e.message }, { status: 503 });

// Conversations of the assistant, most recent first
export async function GET() {
  try {
    return Response.json(await demander('conversations', {}, 10000));
  } catch (e) {
    return erreur(e);
  }
}

// Clears the whole history (the page asks for a confirmation first)
export async function DELETE() {
  try {
    return Response.json(await demander('viderConversations', {}, 10000));
  } catch (e) {
    return erreur(e);
  }
}

import { demander } from '../../../../../lib/assistant.mjs';

export const dynamic = 'force-dynamic';

const erreur = (e) => Response.json({ erreur: e.message }, { status: 503 });

// One conversation with its messages
export async function GET(_req, { params }) {
  const { id } = await params;
  try {
    const conversation = await demander('conversation', { id }, 10000);
    return conversation ? Response.json(conversation) : Response.json({ erreur: 'Conversation inconnue' }, { status: 404 });
  } catch (e) {
    return erreur(e);
  }
}

// Renaming
export async function PATCH(req, { params }) {
  const { id } = await params;
  const corps = await req.json().catch(() => ({}));
  try {
    return Response.json(await demander('renommer', { id, titre: corps?.titre }, 10000));
  } catch (e) {
    return Response.json({ erreur: e.message }, { status: 400 });
  }
}

export async function DELETE(_req, { params }) {
  const { id } = await params;
  try {
    return Response.json(await demander('supprimerConversation', { id }, 10000));
  } catch (e) {
    return erreur(e);
  }
}

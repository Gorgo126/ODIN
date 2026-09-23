import { demander } from '../../../../lib/assistant.mjs';

export const dynamic = 'force-dynamic';

const erreur = (e) => Response.json({ erreur: e.message }, { status: 503 });

// State of the document index: counts, last indexing, files in error, indexing in progress
export async function GET() {
  try {
    return Response.json(await demander('etat', {}, 10000));
  } catch (e) {
    return erreur(e);
  }
}

// « Réindexer »: a scan of the changes, or everything again with { "complet": true }
export async function POST(req) {
  const corps = await req.json().catch(() => ({}));
  try {
    return Response.json(await demander('reindexer', { complet: corps?.complet === true }, 10000));
  } catch (e) {
    return erreur(e);
  }
}

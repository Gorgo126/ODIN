import { demarrer, annuler, supprimer } from '../../../../lib/telechargements.mjs';

export const dynamic = 'force-dynamic';

export async function POST(_req, { params }) {
  const { id } = await params;
  try {
    return Response.json(await demarrer(id));
  } catch (e) {
    return Response.json({ erreur: e.message }, { status: 400 });
  }
}

// Cancels a running download, otherwise uninstalls the pack
export async function DELETE(_req, { params }) {
  const { id } = await params;
  try {
    if (!annuler(id)) await supprimer(id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ erreur: e.message }, { status: 400 });
  }
}

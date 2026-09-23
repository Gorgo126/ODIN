import { demarrer, annuler, supprimer } from '../../../../lib/livres.mjs';

export const dynamic = 'force-dynamic';

const erreur = (e) => Response.json({ erreur: e.message }, { status: 400 });

export async function POST(_req, { params }) {
  const { id } = await params;
  try {
    return Response.json(await demarrer(id));
  } catch (e) {
    return erreur(e);
  }
}

// Cancels a running download, otherwise uninstalls the book
export async function DELETE(_req, { params }) {
  const { id } = await params;
  try {
    if (!annuler(id)) await supprimer(id);
    return Response.json({ ok: true });
  } catch (e) {
    return erreur(e);
  }
}

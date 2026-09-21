import { taille, demarrer, annuler, supprimer } from '../../../../lib/cartes.mjs';

export const dynamic = 'force-dynamic';

const erreur = (e, status = 400) => Response.json({ erreur: e.message }, { status });

// Size before download (a dry-run can take several seconds)
export async function GET(_req, { params }) {
  const { id } = await params;
  try {
    return Response.json({ taille: await taille(id) });
  } catch (e) {
    return erreur(e);
  }
}

export async function POST(_req, { params }) {
  const { id } = await params;
  try {
    return Response.json(await demarrer(id));
  } catch (e) {
    return erreur(e);
  }
}

// Cancels a running download, otherwise deletes the installed pack
export async function DELETE(_req, { params }) {
  const { id } = await params;
  try {
    if (!annuler(id)) await supprimer(id);
    return Response.json({ ok: true });
  } catch (e) {
    return erreur(e);
  }
}

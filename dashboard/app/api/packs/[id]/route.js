import { demarrer, annuler } from '../../../../lib/telechargements.mjs';

export async function POST(_req, { params }) {
  const { id } = await params;
  try {
    return Response.json(await demarrer(id));
  } catch (e) {
    return Response.json({ erreur: e.message }, { status: 400 });
  }
}

export async function DELETE(_req, { params }) {
  const { id } = await params;
  return annuler(id)
    ? Response.json({ ok: true })
    : Response.json({ erreur: 'Aucun téléchargement en cours pour ce pack' }, { status: 404 });
}

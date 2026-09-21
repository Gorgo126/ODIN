import { demarrer } from '../../../../lib/telechargements.mjs';

export async function POST(_req, { params }) {
  const { id } = await params;
  try {
    return Response.json(await demarrer(id));
  } catch (e) {
    return Response.json({ erreur: e.message }, { status: 400 });
  }
}

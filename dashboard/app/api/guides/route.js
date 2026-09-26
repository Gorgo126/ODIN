import { etatGuides, verifier, demarrer, supprimer } from '../../../lib/guides.mjs';

export const dynamic = 'force-dynamic';

const erreur = (e) => Response.json({ erreur: e.message }, { status: 400 });

// Installed version and running installation
export async function GET() {
  return Response.json(await etatGuides());
}

// { action: 'verifier' }: manifest only, differences with titles. { action: 'installer' }: installs
// or updates (same operation), progress through GET.
export async function POST(req) {
  const { action } = await req.json().catch(() => ({}));
  try {
    if (action === 'verifier') return Response.json(await verifier());
    if (action === 'installer') return Response.json(demarrer());
    return Response.json({ erreur: 'Action inconnue' }, { status: 400 });
  } catch (e) {
    return erreur(e);
  }
}

export async function DELETE() {
  try {
    await supprimer();
    return Response.json({ ok: true });
  } catch (e) {
    return erreur(e);
  }
}

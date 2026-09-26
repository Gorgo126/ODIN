import { supprimer } from '../../../../lib/messages.mjs';
import { jetonValide, COOKIE } from '../../../../lib/auth.mjs';

export const dynamic = 'force-dynamic';

// Deletion: behind Caddy's authentication (only /api/messages itself is public), checked here again
export async function DELETE(req, { params }) {
  if (!(await jetonValide(req.cookies.get(COOKIE)?.value))) {
    return Response.json({ erreur: 'Connexion requise' }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[1-9][0-9]{0,15}$/.test(id)) return Response.json({ erreur: 'Message inconnu.' }, { status: 404 });
  try {
    return supprimer(Number(id)) ? new Response(null, { status: 204 }) : Response.json({ erreur: 'Message inconnu.' }, { status: 404 });
  } catch (e) {
    console.error('Mur de messages :', e);
    return Response.json({ erreur: 'Mur de messages indisponible.' }, { status: 503 });
  }
}

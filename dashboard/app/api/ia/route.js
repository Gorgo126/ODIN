import { etat, installer, annuler, tester, activer, desinstaller } from '../../../lib/ia.mjs';

export const dynamic = 'force-dynamic';

// AI option: state (hardware, models, download) and actions of the « Assistant IA » page
export async function GET() {
  return Response.json(await etat(), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req) {
  const corps = await req.json().catch(() => ({}));
  try {
    switch (corps.action) {
      case 'installer': return Response.json(await installer(String(corps.id)));
      case 'annuler': return annuler() ? Response.json({ ok: true }) : Response.json({ erreur: 'Aucun téléchargement en cours' }, { status: 404 });
      case 'tester': return Response.json(await tester());
      case 'activer': await activer(corps.actif === true); return Response.json({ ok: true });
      case 'desinstaller': await desinstaller(String(corps.id)); return Response.json({ ok: true });
      default: return Response.json({ erreur: 'Action inconnue' }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ erreur: e.message }, { status: 400 });
  }
}

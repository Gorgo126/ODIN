import { lireMessages, publier } from '../../../lib/messages.mjs';
import { ipClient } from '../../../lib/portail.mjs';

export const dynamic = 'force-dynamic';

// Public (Caddyfile, @messages): read and post without the ODIN password. Deletion is
// /api/messages/<id>, behind the authentication.
const erreurBase = (e) => {
  console.error('Mur de messages :', e);
  return Response.json({ erreur: 'Mur de messages indisponible.' }, { status: 503 });
};

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const depuis = p.has('since') ? Number(p.get('since')) : NaN;
  const gen = p.has('gen') ? Number(p.get('gen')) : NaN;
  try {
    return Response.json(lireMessages(depuis, gen), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return erreurBase(e);
  }
}

export async function POST(req) {
  // JSON only: a form of another site cannot post (a cross-site JSON request needs a preflight)
  if (!(req.headers.get('content-type') || '').startsWith('application/json')) {
    return Response.json({ erreur: 'Requête invalide.' }, { status: 415 });
  }
  const brut = await req.text();
  if (brut.length > 8192) return Response.json({ erreur: 'Message trop long.' }, { status: 413 });
  let corps;
  try { corps = JSON.parse(brut); } catch { return Response.json({ erreur: 'Requête invalide.' }, { status: 400 }); }
  if (!corps || typeof corps !== 'object') return Response.json({ erreur: 'Requête invalide.' }, { status: 400 });
  try {
    const r = publier(corps, ipClient(req));
    if (r.erreur) return Response.json({ erreur: r.erreur }, { status: r.statut });
    return Response.json(r, { status: 201 });
  } catch (e) {
    return erreurBase(e);
  }
}

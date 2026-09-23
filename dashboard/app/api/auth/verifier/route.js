import { jetonValide, COOKIE } from '../../../../lib/auth.mjs';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (await jetonValide(req.cookies.get(COOKIE)?.value)) {
    return new Response(null, { status: 200 });
  }
  const h = req.headers;
  // The assistant and search APIs are called by scripts and fetch(): a JSON 401 rather than the login page
  if (/^\/api\/(assistant|recherche)(\/|\?|$)/.test(h.get('x-forwarded-uri') || '')) {
    return Response.json({ erreur: 'Connexion requise' }, { status: 401 });
  }
  const hoteComplet = h.get('x-forwarded-host') || h.get('host') || '';
  const hote = hoteComplet.split(':')[0];
  const port = process.env.HTTP_PORT || '80';
  const base = `http://${hote}${port === '80' ? '' : ':' + port}`;
  const retour = `http://${hoteComplet}${h.get('x-forwarded-uri') || '/'}`;
  return new Response(null, {
    status: 302,
    headers: { Location: `${base}/connexion?retour=${encodeURIComponent(retour)}` }
  });
}

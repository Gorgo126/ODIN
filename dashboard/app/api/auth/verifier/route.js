import { jetonValide, COOKIE } from '../../../../lib/auth.mjs';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (await jetonValide(req.cookies.get(COOKIE)?.value)) {
    return new Response(null, { status: 200 });
  }
  const h = req.headers;
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

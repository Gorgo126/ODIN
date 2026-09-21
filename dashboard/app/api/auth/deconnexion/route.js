import { COOKIE } from '../../../../lib/auth.mjs';

export function GET() {
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/connexion',
      'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    }
  });
}

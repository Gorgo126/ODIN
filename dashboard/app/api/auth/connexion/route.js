import { estConfigure, definir, verifierMotDePasse, creerJeton, COOKIE, DUREE_SECONDES } from '../../../../lib/auth.mjs';

export async function POST(req) {
  const f = await req.formData();
  const mdp = String(f.get('mdp') || '');
  const retour = String(f.get('retour') || '/');

  const echec = (code) => new Response(null, {
    status: 303,
    headers: { Location: `/connexion?erreur=${code}&retour=${encodeURIComponent(retour)}` }
  });

  if (!(await estConfigure())) {
    if (mdp.length < 8) return echec('court');
    if (mdp !== String(f.get('confirmation') || '')) return echec('different');
    await definir(mdp);
  } else if (!(await verifierMotDePasse(mdp))) {
    await new Promise((r) => setTimeout(r, 1000));
    return echec('incorrect');
  }

  const hote = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '').split(':')[0];
  let cible = '/';
  try {
    if (retour.startsWith('/') || new URL(retour).hostname === hote) cible = retour;
  } catch {}

  return new Response(null, {
    status: 303,
    headers: {
      Location: cible,
      'Set-Cookie': `${COOKIE}=${await creerJeton()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DUREE_SECONDES}`
    }
  });
}

import { liberer, ipClient, dansReseau, adresseOdin } from '../../../../lib/portail.mjs';

export const dynamic = 'force-dynamic';

// « Continuer » of /portail (an HTML form: no JavaScript, no cookie, works in iOS's mini browser).
// Only devices of the Wi-Fi network can be released.
export async function POST(requete) {
  const ip = ipClient(requete);
  if (!dansReseau(ip, process.env.PORTAIL_RESEAU)) {
    return Response.json({ erreur: 'Réservé aux appareils du réseau Wi-Fi d\'ODIN.' }, { status: 403 });
  }
  liberer(ip);
  const adresse = await adresseOdin();
  return new Response(null, { status: 303, headers: { Location: `${adresse ? `http://${adresse}` : ''}/portail?libre=1`, 'Cache-Control': 'no-store' } });
}

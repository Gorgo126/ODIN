import { trouverSonde, estLibere, ipClient, adresseOdin } from '../../../../lib/portail.mjs';

export const dynamic = 'force-dynamic';

// Every request of a Wi-Fi device for another site, rewritten here by Caddy (original Host kept,
// original path in X-Odin-Chemin). Not released → the portal; released: known probe → its exact
// answer, anything else → ODIN's home page.
async function repondre(requete) {
  const adresse = await adresseOdin();
  const base = adresse ? `http://${adresse}` : '';
  const aller = (chemin) => new Response(null, { status: 302, headers: { Location: base + chemin, 'Cache-Control': 'no-store' } });

  if (!estLibere(ipClient(requete))) return aller('/portail');
  const r = trouverSonde(requete.headers.get('host'), requete.headers.get('x-odin-chemin'));
  if (!r) return aller('/');
  const entetes = { 'Cache-Control': 'no-store', 'X-NetworkManager-Status': 'online' };
  if (r.type) entetes['Content-Type'] = r.type;
  return new Response(r.statut === 204 ? null : r.corps, { status: r.statut, headers: entetes });
}

export const GET = repondre;
export const HEAD = repondre;
export const POST = repondre;

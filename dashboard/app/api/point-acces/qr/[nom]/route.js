import { promises as fs } from 'fs';

export const dynamic = 'force-dynamic';

// QR codes made by qrencode on the host (scripts/point-acces.sh), shown as <img> on the printable
// sheet: an image never runs anything. Behind the login (not in Caddy's @public).
const FICHIERS = { wifi: '/config/point-acces-wifi.svg', adresse: '/config/point-acces-adresse.svg' };

export async function GET(_req, { params }) {
  const { nom } = await params;
  if (!FICHIERS[nom]) return new Response('Inconnu', { status: 404 });
  const svg = await fs.readFile(FICHIERS[nom]).catch(() => null);
  if (!svg) return new Response('QR code absent', { status: 404 });
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox' }
  });
}

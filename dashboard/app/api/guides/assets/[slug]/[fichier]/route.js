import { promises as fs } from 'fs';
import { cheminAsset } from '../../../../../../lib/guides-index.mjs';

export const dynamic = 'force-dynamic';

const TYPES = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

// Image of an installed article (schemas: standalone SVG). Strict path check in cheminAsset. The SVG
// is shown through <img>, where it can run nothing; opened on its own, the CSP sandbox keeps it inert.
export async function GET(_req, { params }) {
  const { slug, fichier } = await params;
  const chemin = await cheminAsset(slug, fichier);
  if (!chemin) return new Response('Introuvable', { status: 404 });
  return new Response(await fs.readFile(chemin), {
    headers: {
      'Content-Type': TYPES[fichier.split('.').pop().toLowerCase()],
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      // Same address across versions: always checked again (cheap, local)
      'Cache-Control': 'private, no-cache'
    }
  });
}

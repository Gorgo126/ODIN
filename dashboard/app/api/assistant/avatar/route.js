import { promises as fs } from 'fs';
import { reglagesAssistant, ecrireReglagesAssistant } from '../../../../lib/assistant.mjs';
import { DEFAUTS } from '../../../../assistant/reglages.mjs';

export const dynamic = 'force-dynamic';

// Picture of the assistant, kept next to the settings. Local file only: it is sent by the browser
// and stored as it is, never fetched from anywhere.
const FICHIER = '/config/avatar';
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const TAILLE_MAX = 300 * 1024;

export async function GET() {
  const { avatarType } = reglagesAssistant();
  try {
    const octets = await fs.readFile(FICHIER);
    return new Response(octets, { headers: { 'Content-Type': avatarType || 'image/png', 'Cache-Control': 'no-store' } });
  } catch {
    return new Response(null, { status: 404 });
  }
}

export async function POST(req) {
  const type = (req.headers.get('content-type') || '').split(';')[0].trim();
  if (!TYPES[type]) return Response.json({ erreur: 'Image PNG, JPEG, WebP ou GIF attendue' }, { status: 400 });
  const octets = Buffer.from(await req.arrayBuffer());
  if (!octets.length) return Response.json({ erreur: 'Image vide' }, { status: 400 });
  if (octets.length > TAILLE_MAX) return Response.json({ erreur: `Image trop lourde (${Math.round(octets.length / 1024)} Ko, 300 Ko au plus)` }, { status: 400 });
  await fs.mkdir('/config', { recursive: true });
  await fs.writeFile(FICHIER, octets);
  const { reglages } = await ecrireReglagesAssistant({ avatar: 'image', avatarType: type });
  return Response.json({ reglages });
}

export async function DELETE() {
  await fs.rm(FICHIER, { force: true });
  const { reglages } = await ecrireReglagesAssistant({ avatar: DEFAUTS.avatar, avatarType: '' });
  return Response.json({ reglages });
}

import { listePacks } from '../../../lib/cartes.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await listePacks());
}

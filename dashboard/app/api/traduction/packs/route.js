import { listeLangues } from '../../../../lib/traduction-packs.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await listeLangues());
}

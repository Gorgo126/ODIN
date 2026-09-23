import { listeLivres } from '../../../lib/livres.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await listeLivres());
}

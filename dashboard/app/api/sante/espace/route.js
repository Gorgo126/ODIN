import { espaceContenus } from '../../../../lib/espace-contenus.mjs';
import { invaliderEspace } from '../../../../lib/espace-cache.mjs';

export const dynamic = 'force-dynamic';

// Last computed space by content, at once (enCours: a computation is running)
export async function GET() {
  return Response.json(espaceContenus());
}

// « Recalculer »: computes again (Mes documents changes are not watched)
export async function POST() {
  invaliderEspace();
  return Response.json(espaceContenus());
}

import { etatSante } from '../../../lib/sante.mjs';

export const dynamic = 'force-dynamic';

// System, containers, version and alert level. Answers within the proxy delay (2 s) even when the
// proxy is down: the containers are then « disponible: false ».
export async function GET() {
  return Response.json(await etatSante());
}

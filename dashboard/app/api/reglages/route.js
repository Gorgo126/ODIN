import { lireReglages, ecrireReglages } from '../../../lib/reglages.mjs';
import { liaison, relancerSonde } from '../../../lib/liaison.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await lireReglages());
}

export async function PUT(req) {
  try {
    const corps = await req.json();
    await ecrireReglages({ mode: corps.mode, silence: corps.silence, liens: corps.liens });
    await relancerSonde();
    return Response.json(await liaison());
  } catch (e) {
    return Response.json({ erreur: e.message }, { status: 400 });
  }
}

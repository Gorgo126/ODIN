import { liaison } from '../../../lib/liaison.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await liaison());
}

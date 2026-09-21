import { lirePacks, infos } from '../../../lib/catalogue.mjs';
import { tache, etatInstallation } from '../../../lib/telechargements.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const packs = await lirePacks().catch(() => []);
  const liste = await Promise.all(packs.map(async (p) => {
    const e = await infos(p).catch(() => null);
    return {
      id: p.id,
      libelle: p.libelle,
      taille: e?.taille || 0,
      disponible: !!e,
      installation: await etatInstallation(p, e),
      tache: tache(p.id)
    };
  }));
  return Response.json(liste);
}

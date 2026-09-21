import { lirePacks, infos, catalogueJoignable, dernieresTailles } from '../../../lib/catalogue.mjs';
import { tache, etatInstallation } from '../../../lib/telechargements.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const packs = await lirePacks().catch(() => []);
  const [enLigne, dernieres] = await Promise.all([catalogueJoignable(), dernieresTailles()]);
  const liste = await Promise.all(packs.map(async (p) => {
    const e = enLigne ? await infos(p).catch(() => null) : null;
    return {
      id: p.id,
      libelle: p.libelle,
      taille: e?.taille || 0,
      // Offline, the last size read while online
      derniereMesure: dernieres[p.id] || 0,
      disponible: !!e,
      installation: await etatInstallation(p, e),
      tache: tache(p.id)
    };
  }));
  return Response.json(liste);
}

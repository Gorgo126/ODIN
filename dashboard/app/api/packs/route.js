import { lirePacks, infos, dernieresTailles } from '../../../lib/catalogue.mjs';
import { enLigne } from '../../../lib/liaison.mjs';
import { tache, etatInstallation } from '../../../lib/telechargements.mjs';
import { licenceZim } from '../../../lib/licences.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const packs = await lirePacks().catch(() => []);
  // Offline or radio silence: no request to the catalogue at all
  const [connecte, dernieres] = await Promise.all([enLigne(), dernieresTailles()]);
  const liste = await Promise.all(packs.map(async (p) => {
    const e = connecte ? await infos(p).catch(() => null) : null;
    return {
      id: p.id,
      libelle: p.libelle,
      licence: licenceZim(p.nom).licence,
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

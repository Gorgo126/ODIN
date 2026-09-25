import { installer, desinstaller, annuler } from '../../../../../lib/traduction-packs.mjs';

export const dynamic = 'force-dynamic';

const erreur = (e) => Response.json({ erreur: e.message }, { status: 400 });

// Install (or resume) a language pack
export async function POST(_req, { params }) {
  const { code } = await params;
  try {
    return Response.json(await installer(code));
  } catch (e) {
    return erreur(e);
  }
}

// Cancels the installation in progress, otherwise removes the language
export async function DELETE(_req, { params }) {
  const { code } = await params;
  if (annuler(code)) return Response.json({ annule: true });
  try {
    await desinstaller(code);
    return Response.json({ retire: true });
  } catch (e) {
    return erreur(e);
  }
}

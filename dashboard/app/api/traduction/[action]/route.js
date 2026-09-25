import { langues, detecter, traduire, LIMITE, ErreurTraduction } from '../../../../lib/traduction.mjs';
import { rechargement } from '../../../../lib/traduction-packs.mjs';

export const dynamic = 'force-dynamic';

const CODE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
const erreur = (message, statut) => Response.json({ erreur: message }, { status: statut });

async function repondre(f) {
  try {
    return Response.json(await f());
  } catch (e) {
    if (e instanceof ErreurTraduction) return erreur(e.message, e.statut);
    console.error(`Traduction : ${e.message}`);
    return erreur('Erreur interne de la traduction.', 500);
  }
}

// GET /api/traduction/languages: { langues, rechargement }. While LibreTranslate reloads its models
// after an installation, rechargement is true, and an unreachable service is not an error.
export async function GET(_requete, { params }) {
  const { action } = await params;
  if (action !== 'languages') return erreur('Action inconnue.', 404);
  try {
    const l = await langues();
    return Response.json({ langues: l, rechargement: await rechargement(l.map((x) => x.code)) });
  } catch (e) {
    if (await rechargement(null)) return Response.json({ langues: null, rechargement: true });
    if (e instanceof ErreurTraduction) return erreur(e.message, e.statut);
    return erreur('Erreur interne de la traduction.', 500);
  }
}

// POST /api/traduction/detect { q } and /api/traduction/translate { q, source, target }
export async function POST(requete, { params }) {
  const { action } = await params;
  if (action !== 'detect' && action !== 'translate') return erreur('Action inconnue.', 404);
  const corps = await requete.json().catch(() => null);
  const q = typeof corps?.q === 'string' ? corps.q : '';
  if (!q.trim()) return erreur('Texte vide.', 400);
  if (q.length > LIMITE) return erreur(`Texte trop long : ${q.length} caractères, ${LIMITE} au plus.`, 400);
  if (action === 'detect') return repondre(() => detecter(q));

  const { source, target } = corps;
  if (!(source === 'auto' || CODE.test(source || '')) || !CODE.test(target || '')) return erreur('Langue invalide.', 400);
  return repondre(() => traduire({ q, source, target }));
}

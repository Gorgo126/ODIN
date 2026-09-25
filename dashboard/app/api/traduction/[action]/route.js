import { langues, detecter, traduire, LIMITE, ErreurTraduction } from '../../../../lib/traduction.mjs';

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

// GET /api/traduction/languages
export async function GET(_requete, { params }) {
  const { action } = await params;
  if (action !== 'languages') return erreur('Action inconnue.', 404);
  return repondre(() => langues());
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

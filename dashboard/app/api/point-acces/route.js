import { lirePointAcces, demanderPointAcces, demandeEnAttente, ACTIONS } from '../../../lib/point-acces.mjs';

export const dynamic = 'force-dynamic';

// State written by the host, plus a request not taken yet
export async function GET() {
  const [etat, attente] = await Promise.all([lirePointAcces(), demandeEnAttente()]);
  return Response.json({ etat, attente }, { headers: { 'Cache-Control': 'no-store' } });
}

// { action: 'activer' | 'desactiver' }: one request file for the host, nothing else. The host checks
// everything again (card, range, current state) before acting.
export async function POST(req) {
  const { action } = await req.json().catch(() => ({}));
  if (!ACTIONS.includes(action)) return Response.json({ erreur: 'Action inconnue' }, { status: 400 });
  const [etat, attente] = await Promise.all([lirePointAcces(), demandeEnAttente()]);
  if (!etat) return Response.json({ erreur: 'Point d\'accès non installé : relancez l\'installeur.' }, { status: 409 });
  if (attente || etat.etat === 'en-cours') return Response.json({ erreur: 'Une action est déjà en cours.' }, { status: 409 });
  if (action === 'activer' && !etat.modeAP) return Response.json({ erreur: 'Aucune carte Wi-Fi compatible.' }, { status: 409 });
  try {
    await demanderPointAcces(action);
    return Response.json({ ok: true }, { status: 202 });
  } catch (e) {
    console.error('Point d\'accès : demande impossible à écrire :', e.message);
    return Response.json({ erreur: 'Demande impossible à transmettre.' }, { status: 500 });
  }
}

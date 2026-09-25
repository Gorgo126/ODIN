// The one definition of every uninstall action of ODIN: route, method, confirmation, and what cannot
// be removed. Used by Configuration and by /sante, in the browser (no server module imported here).
import { octets } from './format.mjs';

const avecTaille = (texte, taille) => (taille ? `${texte} ${octets(taille)} seront libérés.` : texte);

// ZIM pack of catalogue/packs.txt: { id, libelle, taille }
export const suppressionZim = (p) => ({
  methode: 'DELETE',
  url: `/api/packs/${encodeURIComponent(p.id)}`,
  confirmation: avecTaille(`Désinstaller « ${p.libelle} » ?`, p.taille)
});

// Runs a suppression after its confirmation. null: not confirmed; otherwise { ok, erreur }
export async function supprimer(s) {
  if (!s || !confirm(s.confirmation)) return null;
  try {
    const r = await fetch(s.url, {
      method: s.methode,
      headers: s.corps ? { 'Content-Type': 'application/json' } : undefined,
      body: s.corps ? JSON.stringify(s.corps) : undefined
    });
    if (r.ok) return { ok: true };
    return { ok: false, erreur: (await r.json().catch(() => null))?.erreur || `Erreur ${r.status}` };
  } catch {
    return { ok: false, erreur: 'Le serveur ne répond pas.' };
  }
}

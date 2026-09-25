// The one definition of every uninstall action of ODIN: route, method, confirmation, and what cannot
// be removed. Used by Configuration and by /sante, in the browser (no server module imported here).
// Each function returns null for an item that cannot be removed.
import { octets } from './format.mjs';

const avecTaille = (texte, taille) => (taille ? `${texte} ${octets(taille)} seront libérés.` : texte);

// ZIM pack of catalogue/packs.txt: { id, libelle, taille }
export const suppressionZim = (p) => ({
  methode: 'DELETE',
  url: `/api/packs/${encodeURIComponent(p.id)}`,
  confirmation: avecTaille(`Désinstaller « ${p.libelle} » ?`, p.taille)
});

// PDF book: { id, titre, taille }
export const suppressionLivre = (l) => ({
  methode: 'DELETE',
  url: `/api/livres/${encodeURIComponent(l.id)}`,
  confirmation: avecTaille(`Désinstaller « ${l.titre} » ?`, l.taille)
});

// Map pack: { id, libelle, taille, protege }. The world background (protege) stays.
export const suppressionCarte = (p) => (p.protege ? null : {
  methode: 'DELETE',
  url: `/api/cartes/${encodeURIComponent(p.id)}`,
  confirmation: avecTaille(`Supprimer la carte « ${p.libelle} » ?`, p.taille)
});

// Translation language: { code, nom, taille, base }. French and English (base) stay.
export const suppressionLangue = (l) => (l.base ? null : {
  methode: 'DELETE',
  url: `/api/traduction/packs/${encodeURIComponent(l.code)}`,
  confirmation: avecTaille(`Désinstaller « ${l.nom} » ?`, l.taille)
});

// Language model of the AI option: { id, libelle, taille }
export const suppressionModeleIA = (m) => ({
  methode: 'POST',
  url: '/api/ia',
  corps: { action: 'desinstaller', id: m.id },
  confirmation: avecTaille(`Désinstaller ${m.libelle} ?`, m.taille)
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

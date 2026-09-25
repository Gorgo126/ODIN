// State of the space used by each kind of content (/sante), apart from its computation so that the
// download modules can invalidate it without importing all of them (espace-contenus.mjs does).
export const etatEspace = globalThis.__odinEspaceContenus ??= { resultat: null, calcul: null, invalide: true };

// After every installation that ends (done, failed or cancelled) and every removal
export function invaliderEspace() {
  etatEspace.invalide = true;
}

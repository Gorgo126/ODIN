import net from 'net';
import { Resolver } from 'dns/promises';
import { promises as fs } from 'fs';
import { lireReglages } from './reglages.mjs';
import { ecrireJson, lireJson } from './fichiers.mjs';

// Server-side internet probe: the server's connectivity is what matters, never the visitor's.
// Runs in the background (instrumentation.js); requests only read the cached result.
const FICHIER = '/config/liaison.json';
const INTERVALLE = 45000;
const DELAI = 2500;
// While the link holds, the last contact is written at most every 10 minutes
const ECRITURE_MIN = 600000;
const CIBLES = (process.env.LIAISON_CIBLES || '1.1.1.1,9.9.9.9,8.8.8.8').split(',').map((c) => c.trim()).filter(Boolean);
const DOMAINE = process.env.LIAISON_DNS || 'wikipedia.org';

// Shared through globalThis: instrumentation and route handlers are separate bundles
const etat = globalThis.__odinLiaison ??= {
  demarre: false, premier: null, resultat: null, enCours: null, minuterie: null,
  dernierContact: null, ecrit: 0, valeurEcrite: null
};

// TCP connection only: no DNS, no data sent
function tcp(hote) {
  return new Promise((resolve) => {
    const debut = Date.now();
    const s = net.connect({ host: hote, port: 443 });
    let fini = false;
    const fin = (ok) => {
      if (fini) return;
      fini = true;
      clearTimeout(garde);
      s.destroy();
      resolve({ hote, ok, ms: ok ? Date.now() - debut : null });
    };
    const garde = setTimeout(() => fin(false), DELAI);
    s.once('connect', () => fin(true));
    s.once('error', () => fin(false));
  });
}

// c-ares resolver: unlike dns.lookup it does not occupy a libuv thread while blocked
async function dns() {
  const r = new Resolver({ timeout: DELAI, tries: 1 });
  const debut = Date.now();
  const garde = setTimeout(() => r.cancel(), DELAI);
  try {
    await r.resolve4(DOMAINE);
    return { domaine: DOMAINE, ok: true, ms: Date.now() - debut };
  } catch {
    return { domaine: DOMAINE, ok: false, ms: null };
  } finally {
    clearTimeout(garde);
  }
}

async function ecrire() {
  try {
    await fs.mkdir('/config', { recursive: true });
    await ecrireJson(FICHIER, { dernierContact: etat.dernierContact });
    etat.valeurEcrite = etat.dernierContact;
    etat.ecrit = Date.now();
  } catch {}
}

async function sonder() {
  // Radio silence: no outgoing connection at all
  if ((await lireReglages()).silence) {
    etat.resultat = { etat: 'silence', cibles: [], dns: null, dernierTest: null };
    return;
  }
  const [cibles, resolution] = await Promise.all([Promise.all(CIBLES.map(tcp)), dns()]);
  const n = cibles.filter((c) => c.ok).length;
  const valeur = n === 0 ? 'rompue' : n >= 2 && resolution.ok ? 'etablie' : 'degradee';
  const maintenant = Date.now();
  etat.resultat = { etat: valeur, cibles, dns: resolution, dernierTest: maintenant };

  if (valeur === 'etablie') etat.dernierContact = maintenant;
  // Written at once when the link drops, otherwise sparingly
  if (etat.dernierContact !== etat.valeurEcrite
    && (valeur !== 'etablie' || maintenant - etat.ecrit > ECRITURE_MIN)) await ecrire();
}

// One probe at a time; the next one is scheduled when it ends
async function tour() {
  clearTimeout(etat.minuterie);
  etat.enCours ??= sonder().catch(() => {}).finally(() => { etat.enCours = null; });
  await etat.enCours;
  clearTimeout(etat.minuterie);
  etat.minuterie = setTimeout(tour, INTERVALLE);
}

export function demarrerSonde() {
  if (etat.demarre) return;
  etat.demarre = true;
  etat.premier = (async () => {
    etat.dernierContact = (await lireJson(FICHIER, {})).dernierContact || null;
    etat.valeurEcrite = etat.dernierContact;
    await tour();
  })();
}

// After a settings change (radio silence toggled), probe at once instead of waiting
export async function relancerSonde() {
  demarrerSonde();
  await tour();
}

// Last result, returned at once: a running or timing-out probe never delays a page
export async function liaison() {
  demarrerSonde();
  const reglages = await lireReglages();
  const r = etat.resultat;
  // A result from radio silence means nothing once it is lifted
  const valeur = reglages.silence ? 'silence' : r && r.etat !== 'silence' ? r.etat : 'inconnu';
  const enLigne = reglages.mode === 'en-ligne' ? true
    : reglages.mode === 'hors-ligne' ? false
    : valeur === 'etablie' || valeur === 'degradee';
  return {
    etat: valeur,
    enLigne,
    mode: reglages.mode,
    silence: reglages.silence,
    cibles: reglages.silence ? [] : r?.cibles ?? [],
    dns: reglages.silence ? null : r?.dns ?? null,
    dernierTest: reglages.silence ? null : r?.dernierTest ?? null,
    dernierContact: etat.dernierContact,
    liens: reglages.liens
  };
}

// For server features needing internet. Right after startup, waits for the first probe (a few seconds).
export async function enLigne() {
  demarrerSonde();
  if (!etat.resultat) await Promise.race([etat.premier, new Promise((r) => setTimeout(r, 4000))]);
  return (await liaison()).enLigne;
}

export const HORS_LIAISON = 'Nécessite la liaison monde';

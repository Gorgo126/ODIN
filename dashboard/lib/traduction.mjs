// Offline translation: LibreTranslate on its internal Docker network (service « libretranslate »).
// Its healthcheck asks /languages too: the home card and the page use the same test.
const URL_TRADUCTION = process.env.TRADUCTION_URL || 'http://libretranslate:5000';
// Same value as LT_CHAR_LIMIT of the service (TRADUCTION_LIMITE of .env)
export const LIMITE = Number(process.env.TRADUCTION_LIMITE) || 5000;

export const INJOIGNABLE = 'Le service de traduction ne répond pas. Au démarrage du serveur, il lui faut environ une minute ; sinon, voir docker compose logs libretranslate.';

export class ErreurTraduction extends Error {
  constructor(message, statut) { super(message); this.statut = statut; }
}

// JSON call to LibreTranslate. Unreachable or too slow → 503; its own refusal (400) → its message.
async function appeler(chemin, corps, delai) {
  let r;
  try {
    r = await fetch(URL_TRADUCTION + chemin, {
      method: corps ? 'POST' : 'GET',
      headers: corps ? { 'Content-Type': 'application/json' } : undefined,
      body: corps ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(delai),
      cache: 'no-store'
    });
  } catch {
    throw new ErreurTraduction(INJOIGNABLE, 503);
  }
  const donnees = await r.json().catch(() => null);
  if (!r.ok) throw new ErreurTraduction(donnees?.error || `Erreur du service de traduction (${r.status})`, r.status >= 500 ? 502 : 400);
  return donnees;
}

// [{ code, name, targets }], languages of the models installed
export const langues = (delai = 5000) => appeler('/languages', null, delai);

export const detecter = (q) => appeler('/detect', { q }, 5000);

// No total delay for long texts on a slow CPU would block the page: 60 s at most
export const traduire = ({ q, source, target }) => appeler('/translate', { q, source, target, format: 'text' }, 60000);

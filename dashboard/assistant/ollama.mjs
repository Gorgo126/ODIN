// Calls to Ollama, reachable only on the internal Docker network. No total timeout: the first call
// may have to load a model on CPU. Instead, an inactivity delay: the call is aborted when nothing
// (headers or data) has arrived for `inactivite` ms, including while a stream is being received.

export class ErreurOllama extends Error {}

async function* lignes(url, corps, inactivite) {
  const ctrl = new AbortController();
  let minuterie;
  const rearmer = () => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => ctrl.abort(new ErreurOllama(`Ollama ne répond plus depuis ${Math.round(inactivite / 1000)} s`)), inactivite);
  };
  rearmer();
  try {
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
        signal: ctrl.signal
      });
    } catch (e) {
      throw e instanceof ErreurOllama ? e : new ErreurOllama(`Ollama injoignable (${e.cause?.code || e.message})`);
    }
    rearmer();
    if (!r.ok) {
      const texte = await r.text().catch(() => '');
      let message = texte;
      try { message = JSON.parse(texte).error || texte; } catch {}
      if (r.status === 404 && /not found/i.test(message)) {
        throw new ErreurOllama(`modèle ${corps.model} absent d'Ollama : relancez l'installeur avec internet`);
      }
      throw new ErreurOllama(`Ollama : ${message.slice(0, 200) || r.status}`);
    }
    const decodeur = new TextDecoder();
    let reste = '';
    try {
      for await (const bloc of r.body) {
        rearmer();
        reste += decodeur.decode(bloc, { stream: true });
        let i;
        while ((i = reste.indexOf('\n')) !== -1) {
          const ligne = reste.slice(0, i).trim();
          reste = reste.slice(i + 1);
          if (ligne) yield JSON.parse(ligne);
        }
      }
    } catch (e) {
      throw ctrl.signal.aborted ? ctrl.signal.reason : e;
    }
    if (reste.trim()) yield JSON.parse(reste);
  } finally {
    clearTimeout(minuterie);
  }
}

// Streamed call (/api/chat, /api/generate with stream: true): yields each NDJSON object
export function flux(base, chemin, corps, inactivite) {
  return lignes(base + chemin, corps, inactivite);
}

// Plain call: the single JSON answer
export async function appeler(base, chemin, corps, inactivite) {
  let dernier = null;
  for await (const o of lignes(base + chemin, corps, inactivite)) dernier = o;
  if (dernier?.error) throw new ErreurOllama(`Ollama : ${dernier.error}`);
  return dernier;
}

// Installed models, for a clear message when the configured one is missing
export async function modelesInstalles(base) {
  const r = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new ErreurOllama(`Ollama : ${r.status}`);
  return (await r.json()).models.map((m) => m.name);
}

import { demander, reglagesAssistant, configGeneration, reseauAssistant, iaInstallee } from '../../../../lib/assistant.mjs';
import { repondre } from '../../../../assistant/reponse.mjs';

export const dynamic = 'force-dynamic';

// A question to the assistant. Body: { question, historique: [{ question, reponse }] } (last exchange,
// for follow-up questions). Answer: one JSON event per line (NDJSON), sent as soon as it is known.
export async function POST(req) {
  // The assistant writes with a language model: none without the AI option
  if (!iaInstallee()) return Response.json({ erreur: 'L\'assistant IA n\'est pas installé ou pas activé (page Assistant IA) : utilisez la recherche.' }, { status: 503 });
  const corps = await req.json().catch(() => null);
  const question = String(corps?.question ?? '').trim().slice(0, 1000);
  if (!question) return Response.json({ erreur: 'Question vide' }, { status: 400 });
  const historique = (Array.isArray(corps.historique) ? corps.historique : []).slice(-1)
    .map((h) => ({ question: String(h?.question ?? '').slice(0, 1000), reponse: String(h?.reponse ?? '').slice(0, 2000) }))
    .filter((h) => h.question);

  // Debug comes from ?debug=1 on the page, never from the saved settings
  const reglages = { ...reglagesAssistant(), debug: corps?.debug === true };
  // Stopped when the visitor leaves (closed tab) or the stream is cancelled
  const arret = new AbortController();
  const evenements = repondre({
    question,
    historique,
    reglages,
    cfg: configGeneration(),
    rechercher: (q, options) => demander('rechercher', { question: q, ...options }),
    reprendre: (jeton) => demander('reprendre', { jeton }, 10000).catch(() => {}),
    // Network state for the emergency warning: the home page probe, never a second one
    reseau: reseauAssistant,
    signal: AbortSignal.any([req.signal, arret.signal])
  });
  const encodeur = new TextEncoder();
  const conversation = Number(corps?.conversation) || null;
  let fin = null;
  const flux = new ReadableStream({
    async pull(controleur) {
      try {
        const { value, done } = await evenements.next();
        if (done) {
          // The exchange is saved once the answer is finished: an empty conversation is never kept
          if (fin) {
            const c = await demander('ajouterEchange', {
              conversation, question, reponse: fin.texte || '', sources: fin.sources || [], issue: fin.issue
            }, 10000).catch(() => null);
            if (c) controleur.enqueue(encodeur.encode(JSON.stringify({ type: 'conversation', id: c.id, titre: c.titre, modifie: c.modifie }) + '\n'));
          }
          controleur.close();
          return;
        }
        if (value.type === 'fin') fin = value;
        controleur.enqueue(encodeur.encode(JSON.stringify(value) + '\n'));
      } catch (e) {
        controleur.enqueue(encodeur.encode(JSON.stringify({ type: 'erreur', message: e.message }) + '\n'));
        controleur.close();
      }
    },
    cancel() {
      arret.abort();
    }
  });
  return new Response(flux, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      // no-transform: no compression, which would hold the pieces back
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    }
  });
}

import { flux } from './ollama.mjs';

// Language model calls (Ollama /api/chat). Options that decide how the model is loaded (context,
// threads) are the same on every call: a different value would reload it.
// cfg: { ollama, modeleChat, keepAlive, inactivite, threads, numCtx }

function corps(cfg, messages, temperature) {
  return {
    model: cfg.modeleChat,
    messages,
    stream: true,
    think: false,
    keep_alive: cfg.keepAlive,
    options: { num_ctx: cfg.numCtx, temperature, ...(cfg.threads ? { num_thread: cfg.threads } : {}) }
  };
}

// Text pieces as they come
export async function* discuter(cfg, messages, { temperature = 0.4, signal } = {}) {
  for await (const o of flux(cfg.ollama, '/api/chat', corps(cfg, messages, temperature), cfg.inactivite, signal)) {
    if (o.error) throw new Error(`Ollama : ${o.error}`);
    // With think: false there is no reasoning; skipped anyway if a model sends some
    if (o.message?.content) yield o.message.content;
  }
}

// Whole answer at once (question rewriting, summaries)
export async function completer(cfg, messages, options) {
  let texte = '';
  for await (const t of discuter(cfg, messages, options)) texte += t;
  return texte.trim();
}

import { appeler } from './ollama.mjs';

// Some embedding models are trained with task prefixes and lose quality without them.
// EmbeddingGemma: always "task: search result | query: …" for questions and
// "title: … | text: …" for the indexed documents.
const PROFILS = [
  {
    motif: /^embeddinggemma/,
    requete: (q) => `task: search result | query: ${q}`,
    document: (texte, titre) => `title: ${titre || 'none'} | text: ${texte}`
  }
];
const SANS_PREFIXE = { requete: (q) => q, document: (texte) => texte };

export const profil = (modele) => PROFILS.find((p) => p.motif.test(modele)) || SANS_PREFIXE;

// Matryoshka models (EmbeddingGemma) keep their meaning when cut to their first dimensions;
// the cut vector is normalized again, so a dot product is a cosine
export function reduire(v, dimensions) {
  const n = dimensions && dimensions < v.length ? dimensions : v.length;
  const r = new Float32Array(n);
  let somme = 0;
  for (let i = 0; i < n; i++) { r[i] = v[i]; somme += v[i] * v[i]; }
  const norme = Math.sqrt(somme) || 1;
  for (let i = 0; i < n; i++) r[i] /= norme;
  return r;
}

// Full vectors, as returned by the model (they are stored whole, the cut happens in memory).
// cfg.urlVecteurs: a llama.cpp server (OpenAI-style /v1/embeddings) instead of Ollama — measured in
// lot 3 of the advanced search, same prefixes, same model file family.
export async function vectoriser(cfg, textes, signal) {
  if (cfg.urlVecteurs) {
    const res = await appeler(cfg.urlVecteurs, '/v1/embeddings', { input: textes, model: cfg.modeleEmbedding }, cfg.inactivite, signal);
    if (!Array.isArray(res?.data) || res.data.length !== textes.length) throw new Error('Réponse inattendue du serveur de vecteurs');
    return [...res.data].sort((a, b) => a.index - b.index).map((d) => Float32Array.from(d.embedding));
  }
  const res = await appeler(cfg.ollama, '/api/embed', {
    model: cfg.modeleEmbedding,
    input: textes,
    truncate: true,
    keep_alive: cfg.keepAlive,
    // Same value on every call: a change would reload the model
    ...(cfg.threads ? { options: { num_thread: cfg.threads } } : {})
  }, cfg.inactivite, signal);
  if (!Array.isArray(res?.embeddings) || res.embeddings.length !== textes.length) {
    throw new Error('Réponse d\'Ollama inattendue pour les vecteurs');
  }
  return res.embeddings.map((e) => Float32Array.from(e));
}

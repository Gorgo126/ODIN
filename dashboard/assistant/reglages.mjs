// Settings of the document assistant: defaults and validation. Shared by the dashboard (saved in
// data/config/assistant.json, edited from lot 4) and by the evaluation script. No dependency.

export const DEFAUTS = {
  nom: 'Assistant',
  personnalite: {
    tutoiement: true,
    ton: 'chaleureux et simple, comme un proche qui a lu tes papiers',
    longueur: 'adaptee',   // courte | adaptee | detaillee
    humour: false,
    consignes: ''
  },
  jeNeSaisPas: [
    'Je n\'ai rien là-dessus dans tes documents.',
    'Ça, je ne le trouve nulle part dans ce que tu m\'as confié.',
    'Rien dans tes documents ne parle de ça, désolé.',
    'Je cherche, mais tes documents ne disent rien à ce sujet.',
    'Aucun de tes documents n\'aborde cette question.'
  ],
  modeleChat: 'qwen3:1.7b',
  extraits: 4,
  // Best raw cosine of the question against every chunk, calibrated on tests/documents (lot 3,
  // EmbeddingGemma 768 d): answerable 0.40–0.72, close 0.21–0.39, off-topic 0.02–0.15. Between
  // 0.38 and 0.40 the model decides, with [NON_TROUVE].
  seuilReponse: 0.38,
  seuilProches: 0.18,
  temperature: 0.4,
  memoire: true,
  debug: false
};

const LONGUEURS = ['courte', 'adaptee', 'detaillee'];
const texte = (v, max, defaut) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : defaut);
const nombre = (v, min, max, defaut) => (Number.isFinite(Number(v)) ? Math.min(Math.max(Number(v), min), max) : defaut);

// Any saved value is checked and bounded; a missing or invalid one takes its default
export function valider(r = {}) {
  const p = r.personnalite || {};
  const d = DEFAUTS.personnalite;
  const phrases = Array.isArray(r.jeNeSaisPas) ? r.jeNeSaisPas.map((s) => texte(s, 300, '')).filter(Boolean).slice(0, 30) : [];
  const seuilReponse = nombre(r.seuilReponse, 0, 1, DEFAUTS.seuilReponse);
  return {
    nom: texte(r.nom, 40, DEFAUTS.nom),
    personnalite: {
      tutoiement: typeof p.tutoiement === 'boolean' ? p.tutoiement : d.tutoiement,
      ton: texte(p.ton, 200, d.ton),
      longueur: LONGUEURS.includes(p.longueur) ? p.longueur : d.longueur,
      humour: typeof p.humour === 'boolean' ? p.humour : d.humour,
      consignes: typeof p.consignes === 'string' ? p.consignes.trim().slice(0, 1000) : d.consignes
    },
    jeNeSaisPas: phrases.length ? phrases : DEFAUTS.jeNeSaisPas,
    modeleChat: texte(r.modeleChat, 100, DEFAUTS.modeleChat),
    extraits: Math.round(nombre(r.extraits, 1, 8, DEFAUTS.extraits)),
    seuilReponse,
    seuilProches: Math.min(nombre(r.seuilProches, 0, 1, DEFAUTS.seuilProches), seuilReponse),
    temperature: nombre(r.temperature, 0, 1.5, DEFAUTS.temperature),
    memoire: typeof r.memoire === 'boolean' ? r.memoire : DEFAUTS.memoire,
    debug: typeof r.debug === 'boolean' ? r.debug : DEFAUTS.debug
  };
}

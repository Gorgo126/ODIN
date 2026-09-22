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
  // Best raw cosine per source, decided before any call to the language model. Documents
  // (calibrated on tests/documents, lot 3, EmbeddingGemma 768 d): answerable 0.40–0.72, close
  // 0.21–0.39, off-topic 0.02–0.15; at 0.38 a close question got an answer invented from an
  // unrelated chunk, hence 0.40. Wikis and books: see CLAUDE.md for their calibration.
  seuils: {
    documents: { reponse: 0.4, proches: 0.18 },
    wikis: { reponse: 0.4, proches: 0.18 },
    livres: { reponse: 0.4, proches: 0.18 }
  },
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
  const seuils = Object.fromEntries(Object.entries(DEFAUTS.seuils).map(([source, d]) => {
    const lu = r.seuils?.[source] || {};
    const reponse = nombre(lu.reponse, 0, 1, d.reponse);
    return [source, { reponse, proches: Math.min(nombre(lu.proches, 0, 1, d.proches), reponse) }];
  }));
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
    seuils,
    temperature: nombre(r.temperature, 0, 1.5, DEFAUTS.temperature),
    memoire: typeof r.memoire === 'boolean' ? r.memoire : DEFAUTS.memoire,
    debug: typeof r.debug === 'boolean' ? r.debug : DEFAUTS.debug
  };
}

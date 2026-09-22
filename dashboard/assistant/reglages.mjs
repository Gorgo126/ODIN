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
  // Shown first when the question describes a sign of gravity. ODIN serves where everything else
  // may be cut off: the emergency services first « if possible », the installed guides otherwise.
  urgence: 'Si c\'est grave, contacte les secours (112) si c\'est possible. Sinon, consulte les guides médicaux installés sur ODIN.',
  modeleChat: 'qwen3:1.7b',
  extraits: 4,
  // Best raw cosine per source, decided before any call to the language model. Documents
  // (calibrated on tests/documents, lot 3, EmbeddingGemma 768 d): answerable 0.40–0.72, close
  // 0.21–0.39, off-topic 0.02–0.15; at 0.38 a close question got an answer invented from an
  // unrelated chunk, hence 0.40. Wikis (installed on nomad: medicine, Wikivoyage, mathematics):
  // covered questions 0.53–0.64, others 0.27–0.37. Books: covered 0.43–0.66, others 0.02–0.18.
  seuils: {
    documents: { reponse: 0.4, proches: 0.18 },
    wikis: { reponse: 0.48, proches: 0.42 },
    livres: { reponse: 0.45, proches: 0.3 }
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
    urgence: texte(r.urgence, 500, DEFAUTS.urgence),
    modeleChat: texte(r.modeleChat, 100, DEFAUTS.modeleChat),
    extraits: Math.round(nombre(r.extraits, 1, 8, DEFAUTS.extraits)),
    seuils,
    temperature: nombre(r.temperature, 0, 1.5, DEFAUTS.temperature),
    memoire: typeof r.memoire === 'boolean' ? r.memoire : DEFAUTS.memoire,
    debug: typeof r.debug === 'boolean' ? r.debug : DEFAUTS.debug
  };
}

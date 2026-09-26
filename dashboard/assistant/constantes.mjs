// Fixed values of the assistant: everything that is not in the settings page. They used to be
// editable; only their source changed, the code that reads them did not. Modified here, in one
// place, and shipped with the image.

export const CONSTANTES = {
  // Sentences used when nothing is found, one drawn at random. {nom} is the name of the assistant.
  jeNeSaisPas: [
    'Je n\'ai rien là-dessus dans tes documents.',
    'Ça, je ne le trouve nulle part dans ce que tu m\'as confié.',
    'Rien dans tes documents ne parle de ça, désolé.',
    'Je cherche, mais tes documents ne disent rien à ce sujet.',
    'Aucun de tes documents n\'aborde cette question.'
  ],

  // Closing words when the question describes a sign of gravity, chosen from what ODIN knows of the
  // network. No emergency number: it depends on the country. None of them ever says not to call.
  urgences: {
    disponible: 'ODIN a encore accès à internet, donc le réseau fonctionne sans doute aussi : appelle les secours sans attendre. En attendant leur arrivée, suis les guides ci-dessus.',
    indisponible: 'ODIN n\'a plus accès à internet. Essaie quand même d\'appeler les secours : le réseau téléphonique peut fonctionner alors qu\'internet est coupé. Si tu n\'obtiens personne, appuie-toi sur les guides médicaux ci-dessus.',
    inconnu: 'Essaie d\'appeler les secours. Si tu n\'obtiens personne, appuie-toi sur les guides médicaux ci-dessus.'
  },

  // Models: chosen by install.sh from the memory of the machine (MODELE_CHAT, MODELE_EMBEDDING)
  modeleChat: 'qwen3:1.7b',
  modeleEmbedding: 'embeddinggemma:300m',

  // Passages sent to the model, and temperature of its writing
  extraits: 4,
  temperature: 0.4,

  // Best raw cosine per source, decided before any call to the language model. Calibrated on
  // tests/documents and on the packs installed on odintest (lot 3): documents 0.40–0.72 when the answer
  // is there, 0.21–0.39 when it is close; wikis 0.53–0.64 against 0.27–0.37; books 0.43–0.66
  // against 0.02–0.18.
  seuils: {
    documents: { reponse: 0.4, proches: 0.18 },
    wikis: { reponse: 0.48, proches: 0.42 },
    livres: { reponse: 0.45, proches: 0.3 },
    // « Comment faire ? » articles: the thresholds of the books, NOT calibrated yet (added 2026-09-26)
    guides: { reponse: 0.45, proches: 0.3 }
  },

  // Advanced search without the vectors (embedding model unavailable): share of the query found in
  // a passage, rarity-weighted (assistant/bm25.mjs). Provisional, to be calibrated with the synonyms.
  couverture: { forte: 0.75, proches: 0.5 },

  // Banner at the top of the advanced search when the question describes a sign of gravity. Same
  // rules and same network state as the assistant; ODIN's own voice (vous), passages below it.
  bandeauUrgence: {
    disponible: 'ODIN a encore accès à internet, donc le réseau fonctionne sans doute aussi : appelez les secours sans attendre. En attendant leur arrivée, suivez les passages ci-dessous.',
    indisponible: 'ODIN n\'a plus accès à internet. Essayez quand même d\'appeler les secours : le réseau téléphonique peut fonctionner alors qu\'internet est coupé. Si vous n\'obtenez personne, appuyez-vous sur les passages ci-dessous.',
    inconnu: 'Essayez d\'appeler les secours. Si vous n\'obtenez personne, appuyez-vous sur les passages ci-dessous.'
  },

  // Sections that hold what one usually looks for. Closed list, exact match after normalisation:
  // a passage under one of them is preferred (see assistant/bm25.mjs).
  sectionsGenerales: ['premiers soins', 'traitement', 'que faire', 'symptomes', 'prevention', 'diagnostic'],

  // The last exchange is kept, so a follow-up question (« et pour avril ? ») is understood
  memoire: true,

  // Answer to a question about the assistant itself (« qui es-tu ? »), built from the settings
  presentation: {
    tu: 'Je m\'appelle {nom}. Je réponds à tes questions en cherchant dans tes documents, l\'encyclopédie et la bibliothèque d\'ODIN. Je ne sais rien d\'autre.',
    vous: 'Je m\'appelle {nom}. Je réponds à vos questions en cherchant dans vos documents, l\'encyclopédie et la bibliothèque d\'ODIN. Je ne sais rien d\'autre.'
  },

  // Sentence of the assistant when the page opens
  accueil: 'Pose-moi une question sur tes documents, l\'encyclopédie ou la bibliothèque.'
};

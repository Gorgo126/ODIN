import { completer } from './generation.mjs';
import { remplacer } from './prompt.mjs';

// Understanding step, before any search: a short call whose output is a strict JSON object (Ollama
// structured output). It tells a conversation (« salut », « merci ») from a request for
// information, writes the search keywords and the main term, and rewrites a follow-up question
// from the last exchange. Invalid JSON: the raw sentence is searched.

const SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['conversation', 'information'] },
    question: { type: 'string' },
    requete: { type: 'string' },
    terme: { type: 'string' },
    sante: { type: 'boolean' },
    reponse: { type: 'string' }
  },
  required: ['type', 'question', 'requete', 'terme', 'sante', 'reponse']
};

function systeme(reglages) {
  const tu = reglages.personnalite.tutoiement;
  return remplacer(`Tu analyses le message qu'une personne écrit à {nom}, l'assistant d'ODIN, qui cherche dans ses documents personnels, des wikis et des livres. Réponds uniquement par un objet JSON :
- type : "conversation" seulement pour une salutation, un remerciement, une politesse ou une question sur l'assistant lui-même ; "information" pour tout le reste : une question, une demande (même d'écrire un texte), un problème ou une situation décrite, même sans point d'interrogation.
- question : le message réécrit en question complète, qui se comprend seule ; s'il y a un échange précédent, remplace « et pour », « ça », « il » par ce qu'ils désignent.
- requete : 3 à 6 mots-clés de recherche, sans mots vides, avec le terme qu'utiliserait une encyclopédie.
- terme : le terme principal seul, au singulier.
- sante : true si le message touche à la santé, au corps, à un accident, à un danger ou à la sécurité ; false sinon.
- reponse : seulement pour une conversation, une réponse courte et naturelle en ${tu ? 'tutoyant' : 'vouvoyant'}, sans aucune affirmation factuelle ; "" pour une information.

Exemples :
« je me suis brûlé ! » → {"type":"information","question":"Que faire après une brûlure ?","requete":"brûlure premiers soins traitement","terme":"brûlure","sante":true,"reponse":""}
« salut » → {"type":"conversation","question":"Salut","requete":"","terme":"","sante":false,"reponse":"${tu ? 'Salut ! Qu\'est-ce que je peux chercher pour toi ?' : 'Bonjour ! Que puis-je chercher pour vous ?'}"}
« merci beaucoup » → {"type":"conversation","question":"Merci beaucoup","requete":"","terme":"","sante":false,"reponse":"${tu ? 'Avec plaisir ! N\'hésite pas si tu as une autre question.' : 'Avec plaisir ! N\'hésitez pas si vous avez une autre question.'}"}
« écris-moi un poème sur la mer » → {"type":"information","question":"Peux-tu écrire un poème sur la mer ?","requete":"poème mer","terme":"poème","sante":false,"reponse":""}
« combien je paie de loyer ? » → {"type":"information","question":"Combien je paie de loyer par mois ?","requete":"loyer mensuel montant bail","terme":"loyer","sante":false,"reponse":""}`, reglages);
}

const repli = (question) => ({ type: 'information', question, requete: question, terme: '', sante: false, reponse: '', valide: false });

export async function comprendre(cfg, reglages, question, historique = [], signal) {
  const echange = historique.slice(-1).map((h) => `Échange précédent :\nQuestion : ${h.question}\nRéponse : ${String(h.reponse || '').slice(0, 500)}\n\n`).join('');
  let brut;
  try {
    brut = await completer(cfg, [
      { role: 'system', content: systeme(reglages) },
      { role: 'user', content: `${echange}Message : ${question}` }
    ], { temperature: 0, signal, format: SCHEMA, maxJetons: 200 });
  } catch (e) {
    if (signal?.aborted) throw e;
    return repli(question);
  }
  let o;
  try { o = JSON.parse(brut); } catch { return repli(question); }
  if (!o || !['conversation', 'information'].includes(o.type)) return repli(question);
  const ligne = (s, max) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const res = {
    type: o.type,
    question: ligne(o.question, 300) || question,
    requete: ligne(o.requete, 200),
    terme: ligne(o.terme, 60),
    sante: o.sante === true,
    reponse: ligne(o.reponse, 300),
    valide: true
  };
  if (res.type === 'information' && !res.requete) res.requete = res.question;
  return res;
}

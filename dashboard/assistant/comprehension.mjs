import { completer } from './generation.mjs';
import { remplacer } from './prompt.mjs';

// Understanding step, for a request for information only (a conversation is detected by fixed
// rules, conversation.mjs): a short call whose output is a strict JSON object (Ollama structured
// output) that rewrites the search queries: keywords with the medical or technical terms and the
// synonyms, the main term alone, and the standalone question (follow-ups rewritten from the last
// exchange). Invalid JSON: the raw sentence is searched.

const SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    requete: { type: 'string' },
    terme: { type: 'string' },
    sante: { type: 'boolean' },
    gravite: { type: 'boolean' }
  },
  required: ['question', 'requete', 'terme', 'sante', 'gravite']
};

const SYSTEME = `Tu prépares la recherche d'une question posée à {nom}, l'assistant d'ODIN, qui cherche dans des documents personnels, des wikis et des livres. Réponds uniquement par un objet JSON :
- question : la question réécrite pour se comprendre seule ; s'il y a un échange précédent, remplace « et pour », « ça », « il » par ce qu'ils désignent.
- requete : 4 à 8 mots-clés de recherche, sans mots vides : les mots importants de la question, plus les termes médicaux, techniques ou encyclopédiques et les synonymes courants.
- terme : le terme principal seul, au singulier, tel qu'un titre d'encyclopédie.
- sante : true si la question touche à la santé, au corps, à un accident, à un danger ou à la sécurité.
- gravite : true si la personne décrit un signe de gravité : douleur intense, soudaine ou inhabituelle, difficulté à respirer, saignement important, perte de connaissance, brûlure étendue, intoxication.

Exemples :
« je me suis brûlé ! » → {"question":"Que faire après une brûlure ?","requete":"brûlure premiers soins traitement","terme":"brûlure","sante":true,"gravite":false}
« j'ai mal de tête » → {"question":"Que faire contre un mal de tête ?","requete":"mal de tête céphalée migraine douleur traitement","terme":"céphalée","sante":true,"gravite":false}
« comment faire du feu ? » → {"question":"Comment allumer un feu ?","requete":"allumer feu bois foyer allumage","terme":"feu","sante":false,"gravite":false}
« combien je paie de loyer ? » → {"question":"Combien je paie de loyer par mois ?","requete":"loyer mensuel montant bail charges","terme":"loyer","sante":false,"gravite":false}`;

const repli = (question) => ({ question, requete: question, terme: '', sante: false, gravite: false, valide: false });

export async function comprendre(cfg, reglages, question, historique = [], signal) {
  const echange = historique.slice(-1).map((h) => `Échange précédent :\nQuestion : ${h.question}\nRéponse : ${String(h.reponse || '').slice(0, 500)}\n\n`).join('');
  let brut;
  try {
    brut = await completer(cfg, [
      { role: 'system', content: remplacer(SYSTEME, reglages) },
      { role: 'user', content: `${echange}Question : ${question}` }
    ], { temperature: 0, signal, format: SCHEMA, maxJetons: 200 });
  } catch (e) {
    if (signal?.aborted) throw e;
    return repli(question);
  }
  let o;
  try { o = JSON.parse(brut); } catch { return repli(question); }
  if (!o || typeof o !== 'object') return repli(question);
  const ligne = (s, max) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const res = {
    question: ligne(o.question, 300) || question,
    requete: ligne(o.requete, 200),
    terme: ligne(o.terme, 60),
    sante: o.sante === true,
    gravite: o.gravite === true,
    valide: true
  };
  if (!res.requete) res.requete = res.question;
  return res;
}

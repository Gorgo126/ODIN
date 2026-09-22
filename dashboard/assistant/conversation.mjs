import { normaliser } from '../lib/normalisation.mjs';
import { remplacer } from './prompt.mjs';

// Conversation detected by fixed rules, never by the model: a message of 6 words at most, all of
// them in the list below (greetings, thanks, agreement, goodbyes, in French). Anything else is a
// search: « comment faire du feu ? » must never be taken for small talk.

const CATEGORIES = {
  salutation: ['salut', 'bonjour', 'bonsoir', 'coucou', 'hello', 'hey', 'yo', 'bjr', 'slt', 'wesh', 'rebonjour', 'ca', 'va', 'comment', 'vas', 'allez', 'tu', 'vous'],
  remerciement: ['merci', 'mercii', 'thanks', 'remercie', 'je', 'te', 'mille', 'beaucoup', 'bien', 'infiniment', 'bcp'],
  acquiescement: ['ok', 'okay', 'oki', 'dac', 'd', 'accord', 'daccord', 'oui', 'ouais', 'super', 'parfait', 'genial', 'top', 'cool', 'nickel', 'entendu', 'compris', 'bravo', 'excellent', 'tres', 'impeccable', 'ah', 'oh', 'bon', 'bah', 'ben', 'c', 'est', 'note', 'vu', 'ca', 'marche', 'roule'],
  aurevoir: ['au', 'revoir', 'bye', 'ciao', 'tchao', 'a', 'bientot', 'plus', 'tard', 'demain', 'bonne', 'journee', 'soiree', 'nuit', 'fin', 'de', 'la', 'salut', 'adieu']
};
// A word that decides the category (the others only accompany it)
const CLES = {
  aurevoir: ['revoir', 'bye', 'ciao', 'tchao', 'bientot', 'tard', 'demain', 'journee', 'soiree', 'nuit', 'adieu'],
  remerciement: ['merci', 'mercii', 'thanks', 'remercie'],
  salutation: ['salut', 'bonjour', 'bonsoir', 'coucou', 'hello', 'hey', 'yo', 'bjr', 'slt', 'wesh', 'rebonjour'],
  acquiescement: ['ok', 'okay', 'oki', 'dac', 'accord', 'daccord', 'oui', 'ouais', 'super', 'parfait', 'genial', 'top', 'cool', 'nickel', 'entendu', 'compris', 'bravo', 'excellent', 'impeccable', 'note', 'vu', 'marche', 'roule']
};
const TOUS = new Set(Object.values(CATEGORIES).flat());

export function conversation(message) {
  const mots = normaliser(String(message)).replace(/'/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!mots.length || mots.length > 6 || !mots.every((m) => TOUS.has(m))) return null;
  // « ça va », « comment allez-vous » without any greeting word are still greetings
  for (const [categorie, cles] of Object.entries(CLES)) if (mots.some((m) => cles.includes(m))) return categorie;
  return mots.includes('va') || mots.includes('allez') || mots.includes('vas') ? 'salutation' : null;
}

const REPONSES = {
  salutation: { tu: 'Salut ! Je suis {nom}. Qu\'est-ce que je peux chercher pour toi ?', vous: 'Bonjour ! Je suis {nom}. Que puis-je chercher pour vous ?' },
  remerciement: { tu: 'Avec plaisir ! N\'hésite pas si tu as une autre question.', vous: 'Avec plaisir ! N\'hésitez pas si vous avez une autre question.' },
  acquiescement: { tu: 'Très bien. Je reste là si tu as une autre question.', vous: 'Très bien. Je reste là si vous avez une autre question.' },
  aurevoir: { tu: 'À bientôt !', vous: 'À bientôt !' }
};

export function reponseConversation(categorie, reglages) {
  return remplacer(REPONSES[categorie][reglages.personnalite.tutoiement ? 'tu' : 'vous'], reglages);
}

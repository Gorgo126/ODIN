import { normaliser } from '../lib/normalisation.mjs';
import { remplacer } from './prompt.mjs';

// Real signs of gravity, found by fixed rules on the question (the model may miss them, and its own
// flag is only trusted outside the everyday injuries below). ODIN works where everything else is
// cut off: the warning sends to the emergency services if they can be reached, and to the medical
// guides installed otherwise. Common injuries (cut finger, small burn, headache) never raise it.

const SIGNES = [
  // Consciousness, breathing, chest
  /\b(perte de connaissance|perdu connaissance|evanoui|evanouie|s evanouit|inconscient|inconsciente|ne repond plus|ne se reveille pas|coma)\b/,
  /\b(respire (mal|plus|difficilement)|n arrive (pas|plus) a respirer|du mal a respirer|difficulte(s)? a respirer|detresse respiratoire|etouffe|suffoque|s etrangle|asphyxi)/,
  /\b(douleur|mal|serrement|oppression|poids)\b.{0,25}\b(poitrine|thorax|thoracique|sternum)\b/,
  // Bleeding, burns, fractures
  /\b(saigne (beaucoup|abondamment|enormement|sans arret|toujours)|saignement (important|abondant|massif)|le sang (coule|gicle)|hemorragie|perd beaucoup de sang|n arrete pas de saigner|ne s arrete pas de saigner)/,
  /\bbrul(e|ee|ure|ures|ees)\b.{0,40}\b(etendue?s?|grave|graves|profondes?|au visage|aux yeux|tout le bras|toute la jambe|electrique|chimique|3e degre|troisieme degre|second degre)\b/,
  /\b(fracture ouverte|os (qui )?(sort|depasse|traverse la peau))\b/,
  // Other emergencies
  /\b(convulsion|convulse|crise d epilepsie|epileptique)\b/,
  /\b(intoxication|intoxique|empoisonn|a avale (du|de la|des|un|une) (produit|javel|medicament|pilule|essence|soude)|overdose|surdose|monoxyde|champignon veneneux)/,
  /\b(noyade|se noie|s est noye|repeche de l eau)\b/,
  /\b(electrisation|electrocut|foudroy|pris le courant)\b/,
  // Not in the owner's list, kept deliberately: a call for help must not be met with silence
  /\b(suicide|me suicider|me tuer|en finir avec la vie)\b/
];

// Signs found by the words present, in any order (« a avalé de l'eau de javel », « tombé du toit, mal
// au dos »): every group must hold one word of the question. Plurals and feminines match.
const GROUPES = [
  // A dangerous product swallowed
  [['avale', 'avalee', 'bu', 'bue', 'ingere', 'ingeree', 'gobe', 'gobee'],
    ['javel', 'chlore', 'produit', 'medicament', 'pilule', 'comprime', 'cachet', 'essence', 'petrole', 'soude', 'detergent',
      'lessive', 'poison', 'pesticide', 'insecticide', 'raticide', 'acide', 'ammoniaque', 'antigel', 'solvant', 'debouche', 'pile']],
  // A fall from a height
  [['tombe', 'tombee', 'chute', 'chuter', 'glisse', 'glissee'],
    ['toit', 'echelle', 'arbre', 'hauteur', 'etage', 'balcon', 'falaise', 'echafaudage', 'fenetre', 'mur', 'grenier', 'rocher']],
  // Back or neck hurt by a fall, a blow or an accident
  [['tombe', 'tombee', 'chute', 'choc', 'coup', 'accident', 'renverse', 'renversee', 'percute', 'percutee', 'ecrase', 'ecrasee'],
    ['dos', 'nuque', 'cou', 'colonne', 'vertebre', 'rachis']],
  // Legs or arms no longer felt or moved
  [['sent', 'sens', 'bouge', 'bouger', 'remue', 'remuer'], ['plus'], ['jambe', 'bras', 'pied', 'main']]
];
const racine = (m) => m.replace(/(es|s|e|x)$/, '');
function groupes(n) {
  const presents = new Set(n.split(/[^\p{L}\p{N}]+/u).filter(Boolean).flatMap((m) => [m, racine(m)]));
  return GROUPES.some((g) => g.every((mots) => mots.some((m) => presents.has(m) || presents.has(racine(m)))));
}

// Everyday injuries: the model's own flag is not trusted on them
const COURANT = /\b(coupe|coupure|egratignure|ecorchure|griffure|bleu|bosse|ampoule|echarde|piqure de moustique|petite brulure|mal de (tete|dos|ventre|gorge)|rhume|courbature|entorse legere)\b/;

export function signeDeGravite(question, drapeauModele = false) {
  const n = normaliser(String(question)).replace(/['’]/g, ' ').replace(/\s+/g, ' ');
  if (SIGNES.some((r) => r.test(n)) || groupes(n)) return true;
  return drapeauModele && !COURANT.test(n);
}

// Wording chosen from what ODIN knows of the network (« disponible », « indisponible », « inconnu »):
// with internet the phone network probably works too; without it, trying is still worth it.
export const messageUrgence = (reglages, reseau) => remplacer(reglages.urgences[reseau] || reglages.urgences.inconnu, reglages);

// A source that can help right away when the emergency services cannot be reached
export const estGuide = (e) => e?.guide === true;

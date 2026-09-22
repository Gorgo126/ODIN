import { normaliser } from '../lib/normalisation.mjs';

// Signs of gravity in the question itself, found by fixed rules (the model may miss them): the 112
// reminder is then shown first, whatever the outcome, even when nothing is found. The understanding
// step can also raise it (gravite), for wordings these rules do not know.

const SIGNES = [
  // Intense, sudden or unusual pain
  /\b(douleur|mal)\b.{0,40}\b(intense|violente?|atroce|insupportable|terrible|enorme|brutale?|soudaine?|inhabituelle?|tres tres|tres forte?|horrible)/,
  /\b(tres tres|horriblement|atrocement|terriblement) mal\b/,
  /\bmal (de|a la|au|aux) [a-z]+ (tres )+fort/,
  /\b(douleur|mal|serre|oppression)\b.{0,25}\b(poitrine|thorax|thoracique|coeur)\b/,
  // Breathing, consciousness, bleeding, burns
  /\b(respire (mal|plus|difficilement)|n arrive (pas|plus) a respirer|du mal a respirer|difficulte(s)? a respirer|etouffe|suffoque|s etouffe)/,
  /\b(evanoui|evanouie|perdu connaissance|perte de connaissance|inconsciente?|ne repond plus|ne se reveille pas|malaise)\b/,
  /\b(saigne (beaucoup|abondamment|enormement|sans arret)|saignement (important|abondant|qui ne s arrete pas)|hemorragie|perd beaucoup de sang)/,
  /\bbrul(e|ure|ee|es|ures)\b.{0,40}\b(etendue?|grave|profonde?|visage|yeux|main entiere|bras entier|jambe entiere|electrique|chimique)\b/,
  // Other emergencies
  /\b(convulsion|convulse|crise d epilepsie|avc|paralys|visage qui tombe|n arrive plus a parler)/,
  /\b(intoxication|intoxique|empoisonn|a avale|avale (des|un|une|du)|overdose|surdose|monoxyde)\b/,
  /\b(suicide|me suicider|me tuer|en finir)\b/,
  /\b(noyade|se noie|electrocut|chute grave|ne bouge plus)/
];

export function signeDeGravite(question) {
  const n = normaliser(String(question)).replace(/['’]/g, ' ').replace(/\s+/g, ' ');
  return SIGNES.some((r) => r.test(n));
}

export function rappelUrgence(reglages) {
  return reglages.personnalite.tutoiement
    ? 'Ce que tu décris peut être grave : appelle le 112 sans attendre.'
    : 'Ce que vous décrivez peut être grave : appelez le 112 sans attendre.';
}

export function rappelSante(reglages) {
  return reglages.personnalite.tutoiement ? 'En cas de signe de gravité, appelle le 112.' : 'En cas de signe de gravité, appelez le 112.';
}

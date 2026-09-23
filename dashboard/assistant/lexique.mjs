// Which words of a question may be its « main term » (assistant/terme.mjs): a noun or a noun
// phrase, never a pronoun, an auxiliary, a common verb, a number, an adverb, a time word or a person.
// No grammar tool in ODIN (no dependency): closed lists of normalized words (lib/normalisation.mjs),
// plus, for the rarest-word fallback, the rule that the word must appear in a heading of the
// passages found (titles and section headings are nearly always noun phrases).

const liste = (s) => new Set(s.split(/\s+/).filter(Boolean));

// Articles, prepositions, conjunctions, pronouns, possessives
const OUTILS = liste(`a ai au aux avec c ca ce ceci cela ces cet cette ceux celle celles celui chez comme comment combien d dans de des
  donc du elle elles en entre et eux il ils j je l la le les leur leurs lui m ma mais me mes moi mon n ne ni nos notre nous on ou par
  pas pour pourquoi quand que quel quelle quelles quels qui quoi s sa se ses si son sous sur t ta te tes toi ton tu un une vers vos
  votre vous y alors quelque quelques chaque aucun aucune rien personne`);
// Auxiliaries and the verbs every question uses, in their common forms
const VERBES = liste(`suis es est sommes etes sont etais etait etions etiez etaient serai sera serons seront serait ete etre
  ai as avons avez ont avais avait avions aviez avaient aurai aura aurait eu eue avoir
  vais vas va allons allez vont aller alle allee fais fait faisons faites font faire faisait
  peux peut pouvons pouvez peuvent pouvoir pourrait veux veut voulons voulez veulent vouloir voudrais
  dois doit devons devez doivent devoir sais sait savons savez savent savoir vois voit voir mets met mettre
  prends prend prendre dis dit dire viens vient venir faut falloir semble sembler reste rester devient devenir
  donne donner trouve trouver passe passer arrive arriver
  manger mange mangee boire bu bois boit dormir dort tomber tombe tombee tombes marcher marche courir cours court
  respirer respire soigner soigne guerir aider aide garder garde utiliser utilise savoir chercher cherche
  appeler appelle attendre attend sortir sort rentrer entrer ouvrir fermer laver lave couper coupe mettre casser
  avaler avale avalee toucher touche sentir sent bouger bouge vivre vit mourir meurt meurs perdre perd perdu
  rendre rend gagner porter porte laisser laisse tenir tient penser pense croire crois devenir devient`);
const NOMBRES = liste(`zero un une deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize vingt
  trente quarante cinquante soixante septante huitante nonante cent cents mille million millions milliard premier premiere
  second seconde deuxieme troisieme quatrieme cinquieme dixieme moitie quart tiers demi demie douzaine dizaine centaine`);
const ADVERBES = liste(`tres trop beaucoup peu plus moins encore deja toujours jamais souvent parfois depuis aussi tout tous toute
  toutes bien mal vite ici la aujourd aujourdhui hier demain maintenant presque surtout vraiment environ assez tellement tant
  partout dehors dedans ensemble seulement plutot enfin puis ensuite avant apres pendant bientot longtemps oui non autant ainsi`);
// Time and persons: they say when and who, never what the question is about
const TEMPS = liste(`jour jours journee journees semaine semaines mois an ans annee annees heure heures minute minutes seconde
  secondes matin matinee soir soiree nuit nuits lundi mardi mercredi jeudi vendredi samedi dimanche weekend fois instant`);
const PERSONNES = liste(`bebe bebes enfant enfants fils fille filles garcon garcons mere pere femme femmes mari homme hommes frere
  freres soeur soeurs parent parents grandmere grandpere papa maman papy mamie personne personnes gens voisin voisine voisins
  ami amie amis copain copine famille monsieur madame`);

const EXCLUS = [OUTILS, VERBES, NOMBRES, ADVERBES, TEMPS, PERSONNES];

// A normalized word that can be (part of) a main term: letters, 3 at least, not in the lists
export function peutEtreNom(mot) {
  if (!/^\p{L}{3,}$/u.test(mot)) return false;
  return !EXCLUS.some((l) => l.has(mot));
}

// A title (normalized words) that can be a main term: 4 letters at least, not starting with a
// pronoun, an auxiliary or a number, and holding at least one noun
export function titreNominal(mots) {
  if (!mots.length || mots.join('').length < 4) return false;
  const [premier] = mots;
  if (OUTILS.has(premier) || VERBES.has(premier) || NOMBRES.has(premier) || ADVERBES.has(premier)) return false;
  return mots.some(peutEtreNom);
}

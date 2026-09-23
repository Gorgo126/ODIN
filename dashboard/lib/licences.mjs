// Licence of a ZIM pack, from its Kiwix name (wikipedia_fr_medicine_maxi_2026-07): the Kiwix catalogue
// does not give it. Shown in the reader and in Configuration. Texts only: the images of the
// Wikimedia projects each have their own licence (Wikimedia Commons).

const CC_BY_SA_4 = 'https://creativecommons.org/licenses/by-sa/4.0/deed.fr';
const WIKIMEDIA = {
  wikipedia: 'Wikipédia', wiktionary: 'Wiktionnaire', wikisource: 'Wikisource', wikibooks: 'Wikilivres',
  wikiversity: 'Wikiversité', wikivoyage: 'Wikivoyage', wikiquote: 'Wikiquote', wikinews: 'Wikinews'
};

export function licenceZim(nom) {
  const projet = String(nom || '').split('_')[0];
  if (WIKIMEDIA[projet]) {
    return { licence: 'CC BY-SA 4.0', url: CC_BY_SA_4, auteurs: `contributeurs de ${WIKIMEDIA[projet]}`, note: 'Les images ont chacune leur licence.' };
  }
  if (projet === 'vikidia') {
    return { licence: 'CC BY-SA 3.0 et GFDL', url: 'https://fr.vikidia.org/wiki/Vikidia:Droit_d%27auteur', auteurs: 'contributeurs de Vikidia', note: 'Les images ont chacune leur licence.' };
  }
  if (projet === 'gutenberg') {
    return { licence: 'domaine public (licence et marque Project Gutenberg)', url: 'https://www.gutenberg.org/policy/license.html', auteurs: 'Projet Gutenberg', note: '' };
  }
  // A pack added by hand: its licence is in the pack itself
  return { licence: 'voir la source du pack', url: null, auteurs: '', note: '' };
}

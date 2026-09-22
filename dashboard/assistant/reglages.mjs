import { CONSTANTES } from './constantes.mjs';

// Settings of the assistant: only what the settings page offers (name, face, colour, tone, form of
// address, length of the answers) is read from data/config/assistant.json. Everything else comes
// from constantes.mjs. valider() builds a fresh object: an older and richer file keeps what it can,
// and its unknown keys are simply ignored.

export const DEFAUTS = {
  ...CONSTANTES,
  nom: 'Assistant',
  // Name of a pixel art face (app/assistant/Sprite.jsx); an unknown one falls back to the first
  avatar: 'corbeau',
  couleur: '#d4a04a',
  configure: false,
  personnalite: {
    tutoiement: true,
    ton: 'chaleureux et simple, comme un proche qui a lu tes papiers',
    longueur: 'adaptee',   // courte | adaptee | detaillee
    humour: false,
    consignes: ''
  },
  // Only set by ?debug=1 on /assistant, never saved
  debug: false
};

const LONGUEURS = ['courte', 'adaptee', 'detaillee'];
const texte = (v, max, defaut) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : defaut);

export function valider(r = {}) {
  const p = r.personnalite || {};
  const d = DEFAUTS.personnalite;
  return {
    ...CONSTANTES,
    nom: texte(r.nom, 40, DEFAUTS.nom),
    avatar: /^[a-z]{3,16}$/.test(String(r.avatar || '')) ? String(r.avatar) : DEFAUTS.avatar,
    couleur: /^#[0-9a-f]{6}$/i.test(String(r.couleur || '')) ? String(r.couleur).toLowerCase() : DEFAUTS.couleur,
    configure: r.configure === true,
    personnalite: {
      tutoiement: typeof p.tutoiement === 'boolean' ? p.tutoiement : d.tutoiement,
      ton: texte(p.ton, 200, d.ton),
      longueur: LONGUEURS.includes(p.longueur) ? p.longueur : d.longueur,
      humour: d.humour,
      consignes: d.consignes
    },
    debug: r.debug === true
  };
}

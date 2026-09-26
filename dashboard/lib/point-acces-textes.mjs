// Words of the access point state, without any Node module: shared by the pages and the browser
// Reasons in plain words, same as the script's messages
export const RAISONS = {
  'aucune-carte': 'Aucune carte Wi-Fi compatible détectée.',
  'pas-de-mode-ap': 'La carte Wi-Fi ne sait pas créer de point d\'accès.',
  'plage-occupee': 'La plage d\'adresses du réseau Wi-Fi chevauche un réseau de la machine ou de Docker : relancez l\'installeur, qui en choisira une autre.',
  'plage-invalide': 'POINT_ACCES_RESEAU est invalide dans .env.',
  'echec-demarrage': 'Le point d\'accès n\'a pas démarré (journal : journalctl -u odin-hostapd).'
};

export const ETATS = { actif: 'Actif', inactif: 'Inactif', indisponible: 'Aucune carte compatible', 'en-cours': 'Action en cours' };

// One line for the home card and Configuration
export function resumePointAcces(e) {
  if (!e) return 'Non installé';
  if (e.etat === 'actif') return 'Actif';
  if (e.etat === 'en-cours') return e.derniereAction?.action === 'desactiver' ? 'Désactivation en cours' : 'Activation en cours';
  if (e.etat === 'indisponible') return e.raison === 'pas-de-mode-ap' || e.raison === 'aucune-carte' ? 'Aucune carte compatible' : 'Indisponible';
  return 'Inactif';
}

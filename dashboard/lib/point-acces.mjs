// Access point state for the pages (Configuration, printable sheet). Written by scripts/point-acces.sh
// only; reasons in plain words, same as the script's messages.
export const RAISONS = {
  'aucune-carte': 'Aucune carte Wi-Fi détectée.',
  'pas-de-mode-ap': 'La carte Wi-Fi ne sait pas créer de point d\'accès.',
  'wifi-occupe': 'La carte Wi-Fi sert déjà à la connexion de cette machine : utilisez l\'Ethernet pour la préparation.',
  'plage-occupee': 'La plage d\'adresses du réseau Wi-Fi est déjà utilisée par une autre interface (POINT_ACCES_RESEAU dans .env).',
  'echec-demarrage': 'Le point d\'accès n\'a pas démarré (journal : journalctl -u odin-hostapd).'
};

export const ETATS = { actif: 'Actif', inactif: 'Désactivé', indisponible: 'Indisponible' };

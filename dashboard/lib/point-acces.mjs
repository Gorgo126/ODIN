import { promises as fs } from 'fs';
import path from 'path';
import { lireJson } from './fichiers.mjs';

export { RAISONS, ETATS, resumePointAcces } from './point-acces-textes.mjs';

// Wi-Fi access point, seen from the dashboard. The state is written by scripts/point-acces.sh on the
// host (data/config/point-acces.json); the dashboard never runs anything: it drops one request file,
// which a systemd .path unit hands to the script (fixed list of actions, read as data).
const DOSSIER = '/config';
const ETAT = path.join(DOSSIER, 'point-acces.json');
const DEMANDE = path.join(DOSSIER, 'point-acces-demande');
export const ACTIONS = ['activer', 'desactiver'];

export const lirePointAcces = () => lireJson(ETAT, null);

// Request file, written in one go (temporary name, then rename): the .path unit never sees half a file
export async function demanderPointAcces(action) {
  if (!ACTIONS.includes(action)) throw new Error('Action inconnue');
  const tmp = path.join(DOSSIER, `.point-acces-demande-${process.pid}`);
  await fs.writeFile(tmp, `${action}\n`, { mode: 0o600 });
  await fs.rename(tmp, DEMANDE);
}

// A request not taken yet by the host (its .path unit removes the file at once)
export const demandeEnAttente = () => fs.access(DEMANDE).then(() => true, () => false);

import { mkdirSync } from 'fs';
import path from 'path';

// Local message wall (/messages): one thread shared by the devices of the local network, without an
// account. SQLite by node:sqlite (Node 24 in the image), through getBuiltinModule so that webpack
// never tries to bundle it. One connection per process, kept in globalThis (instrumentation.js and
// the routes are separate bundles).
const DOSSIER = process.env.MESSAGES_DOSSIER || '/messages';
const FICHIER = path.join(DOSSIER, 'messages.db');
export const TEXTE_MAX = 500;
export const PSEUDO_MAX = 30;
const DUREE = 30 * 24 * 3600 * 1000;
const NOMBRE_MAX = 2000;
const INTERVALLE_PURGE = 5 * 60 * 1000;
// One message every 3 s per IP address
const INTERVALLE_ENVOI = 3000;

const etat = globalThis.__odinMessages ??= { db: null, purge: 0, envois: new Map() };

function base() {
  if (etat.db) return etat.db;
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  mkdirSync(DOSSIER, { recursive: true });
  const db = new DatabaseSync(FICHIER);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 2000;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pseudo TEXT NOT NULL,
      texte TEXT NOT NULL,
      date INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_date ON messages(date);
    CREATE TABLE IF NOT EXISTS meta (cle TEXT PRIMARY KEY, valeur INTEGER NOT NULL);
  `);
  // Generation: changes whenever messages disappear (deletion, purge) or the base is new. A client
  // with another generation reloads the whole thread instead of asking only for newer ids.
  db.prepare("INSERT OR IGNORE INTO meta (cle, valeur) VALUES ('generation', ?)").run(Date.now());
  etat.db = db;
  return db;
}

const generation = (db) => db.prepare("SELECT valeur FROM meta WHERE cle = 'generation'").get().valeur;
const nouvelleGeneration = (db) => db.prepare("UPDATE meta SET valeur = valeur + 1 WHERE cle = 'generation'").run();

// Older than 30 days, then beyond the 2000 most recent
function purger(db, maintenant, forcer = false) {
  if (!forcer && maintenant - etat.purge < INTERVALLE_PURGE) return;
  etat.purge = maintenant;
  const a = db.prepare('DELETE FROM messages WHERE date < ?').run(maintenant - DUREE).changes;
  const b = db.prepare('DELETE FROM messages WHERE id <= (SELECT id FROM messages ORDER BY id DESC LIMIT 1 OFFSET ?)').run(NOMBRE_MAX).changes;
  if (a + b > 0) nouvelleGeneration(db);
}

// Plain text: no control characters but line breaks, at most two empty lines in a row
export function nettoyerTexte(t) {
  return String(t ?? '').normalize('NFC').replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

export function nettoyerPseudo(p) {
  return String(p ?? '').normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const longueur = (s) => Array.from(s).length;

// Thread for a client: only the messages after « depuis » when its generation is still valid,
// otherwise everything (complet). Most recent first.
export function lireMessages(depuis, gen) {
  const db = base();
  const maintenant = Date.now();
  purger(db, maintenant);
  const g = generation(db);
  const suite = Number.isSafeInteger(depuis) && depuis >= 0 && gen === g;
  const messages = suite
    ? db.prepare('SELECT id, pseudo, texte, date FROM messages WHERE id > ? ORDER BY id DESC').all(depuis)
    : db.prepare('SELECT id, pseudo, texte, date FROM messages ORDER BY id DESC').all();
  return { messages, complet: !suite, generation: g, maintenant };
}

// Returns { erreur, statut } or { message }
export function publier({ pseudo, texte }, ip) {
  const p = nettoyerPseudo(pseudo);
  const t = nettoyerTexte(texte);
  if (!p) return { statut: 400, erreur: 'Indiquez un pseudo.' };
  if (longueur(p) > PSEUDO_MAX) return { statut: 400, erreur: `Pseudo trop long (${PSEUDO_MAX} caractères au plus).` };
  if (!t) return { statut: 400, erreur: 'Le message est vide.' };
  if (longueur(t) > TEXTE_MAX) return { statut: 400, erreur: `Message trop long (${TEXTE_MAX} caractères au plus).` };

  const maintenant = Date.now();
  const dernier = etat.envois.get(ip || '?');
  if (dernier && maintenant - dernier < INTERVALLE_ENVOI) {
    return { statut: 429, erreur: 'Un message toutes les 3 secondes au plus. Réessayez dans un instant.' };
  }
  etat.envois.set(ip || '?', maintenant);
  if (etat.envois.size > 1000) {
    for (const [cle, date] of etat.envois) if (maintenant - date >= INTERVALLE_ENVOI) etat.envois.delete(cle);
  }

  const db = base();
  const { lastInsertRowid } = db.prepare('INSERT INTO messages (pseudo, texte, date) VALUES (?, ?, ?)').run(p, t, maintenant);
  purger(db, maintenant, true);
  return { message: { id: Number(lastInsertRowid), pseudo: p, texte: t, date: maintenant }, maintenant };
}

export function supprimer(id) {
  const db = base();
  const n = db.prepare('DELETE FROM messages WHERE id = ?').run(id).changes;
  if (n) nouvelleGeneration(db);
  return n > 0;
}

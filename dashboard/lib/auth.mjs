import { promises as fs } from 'fs';
import crypto from 'crypto';

const FICHIER = '/config/auth.json';
const DUREE = 30 * 24 * 3600 * 1000;
export const COOKIE = 'odin_session';

async function lire() {
  try { return JSON.parse(await fs.readFile(FICHIER, 'utf8')); } catch { return null; }
}

const hacher = (mdp, sel) => crypto.scryptSync(mdp, sel, 64).toString('hex');
const signer = (secret, texte) => crypto.createHmac('sha256', secret).update(texte).digest('hex');
const egal = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function estConfigure() {
  return !!(await lire());
}

export async function definir(mdp) {
  if (await lire()) throw new Error('Mot de passe déjà défini');
  const sel = crypto.randomBytes(16).toString('hex');
  const donnees = { sel, hash: hacher(mdp, sel), secret: crypto.randomBytes(32).toString('hex') };
  await fs.mkdir('/config', { recursive: true });
  await fs.writeFile(FICHIER, JSON.stringify(donnees), { mode: 0o600 });
}

export async function verifierMotDePasse(mdp) {
  const a = await lire();
  return !!a && egal(hacher(mdp, a.sel), a.hash);
}

export async function creerJeton() {
  const a = await lire();
  const expiration = String(Date.now() + DUREE);
  return `${expiration}.${signer(a.secret, expiration)}`;
}

export async function jetonValide(jeton) {
  const a = await lire();
  if (!a || !jeton) return false;
  const [expiration, signature] = jeton.split('.');
  if (!expiration || !signature || Number(expiration) < Date.now()) return false;
  return egal(signature, signer(a.secret, expiration));
}

export const DUREE_SECONDES = DUREE / 1000;

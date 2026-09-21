import { promises as fs } from 'fs';

// ODIN settings edited from the Configuration page, kept next to auth.json on the config volume
const FICHIER = '/config/reglages.json';
const MODES = ['auto', 'hors-ligne', 'en-ligne'];
const DEFAUT = {
  mode: 'auto',
  silence: false,
  liens: [{ libelle: 'World Monitor', url: 'https://www.worldmonitor.app/dashboard' }]
};

// Shared through globalThis: instrumentation and route handlers are separate bundles
const memoire = globalThis.__odinReglages ??= { valeur: null };

function valider(r) {
  if (!MODES.includes(r.mode)) throw new Error('Mode inconnu');
  if (typeof r.silence !== 'boolean') throw new Error('Silence radio : oui ou non attendu');
  if (!Array.isArray(r.liens) || r.liens.length > 20) throw new Error('Liste de liens invalide (20 au plus)');
  const liens = r.liens.map((l) => {
    const libelle = String(l?.libelle ?? '').trim().slice(0, 60);
    if (!libelle) throw new Error('Chaque lien a besoin d\'un libellé');
    let url;
    try { url = new URL(String(l?.url ?? '').trim()); } catch { throw new Error(`Adresse invalide : ${l?.url || '(vide)'}`); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Adresse http ou https attendue : ${l.url}`);
    return { libelle, url: url.href };
  });
  return { mode: r.mode, silence: r.silence, liens };
}

export async function lireReglages() {
  if (!memoire.valeur) {
    let lu = {};
    try { lu = JSON.parse(await fs.readFile(FICHIER, 'utf8')); } catch {}
    try { memoire.valeur = valider({ ...DEFAUT, ...lu }); } catch { memoire.valeur = DEFAUT; }
  }
  return memoire.valeur;
}

export async function ecrireReglages(modifs) {
  // Missing fields keep their saved value
  const definis = Object.fromEntries(Object.entries(modifs).filter(([, v]) => v !== undefined));
  const valeur = valider({ ...(await lireReglages()), ...definis });
  await fs.mkdir('/config', { recursive: true });
  await fs.writeFile(FICHIER + '.tmp', JSON.stringify(valeur, null, 1));
  await fs.rename(FICHIER + '.tmp', FICHIER);
  memoire.valeur = valeur;
  return valeur;
}

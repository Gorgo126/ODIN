import { DatabaseSync } from 'node:sqlite';
import { promises as fs, createReadStream } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { extraire, FormatNonPrisEnCharge } from './extraction.mjs';
import { decouper } from './decoupage.mjs';
import { profil, reduire, vectoriser } from './embeddings.mjs';
import { ErreurOllama } from './ollama.mjs';
import { normaliser, motsRequete } from '../lib/normalisation.mjs';

// Index of the personal documents: files, chunks, full-text index (FTS5) and vectors (Float32 BLOB,
// loaded in memory, cosine in JS). Runs in the assistant's worker thread, never on Next's event loop.

const LOT = 8;          // chunks per embedding call
const RECHARGE = 30000; // at most every 30 s during a long indexing, the in-memory vectors are refreshed
const K_RRF = 60;

const log = (...a) => console.log('[assistant]', ...a);

function ouvrir(fichier) {
  const db = new DatabaseSync(fichier);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS meta (cle TEXT PRIMARY KEY, valeur TEXT);
    CREATE TABLE IF NOT EXISTS fichiers (
      chemin TEXT PRIMARY KEY, taille INTEGER, mtime REAL, empreinte TEXT,
      statut TEXT NOT NULL, erreur TEXT, type TEXT, titre TEXT, resume TEXT,
      morceaux INTEGER NOT NULL DEFAULT 0, indexe_le INTEGER);
    CREATE TABLE IF NOT EXISTS morceaux (
      id INTEGER PRIMARY KEY, chemin TEXT NOT NULL, rang INTEGER NOT NULL,
      page INTEGER, section TEXT, texte TEXT NOT NULL, vecteur BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS morceaux_chemin ON morceaux (chemin);
    -- Normalized text (no accents, no case, ligatures expanded), rowid = morceaux.id
    CREATE VIRTUAL TABLE IF NOT EXISTS morceaux_fts USING fts5 (
      texte, section, titre, content = '', contentless_delete = 1, tokenize = 'unicode61');
  `);
  return db;
}

async function empreinte(fichier) {
  const h = createHash('sha256');
  for await (const bloc of createReadStream(fichier)) h.update(bloc);
  return h.digest('hex');
}

// Every file under the root, hidden ones and symbolic links excepted
async function lister(racine, dossier = racine, res = []) {
  let entrees;
  try { entrees = await fs.readdir(dossier, { withFileTypes: true }); } catch { return res; }
  for (const e of entrees) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dossier, e.name);
    if (e.isDirectory()) await lister(racine, abs, res);
    else if (e.isFile()) {
      const s = await fs.stat(abs).catch(() => null);
      if (s) res.push({ chemin: path.relative(racine, abs).split(path.sep).join('/'), abs, taille: s.size, mtime: s.mtimeMs });
    }
  }
  return res;
}

// One-line summary until the language model writes a real one (lot 3): the first sentence
function resumeProvisoire(blocs) {
  const p = blocs.find((b) => !b.titre && b.texte.length > 40)?.texte || blocs[0]?.texte || '';
  const phrase = (p.match(/^.+?[.!?…](?=\s|$)/) || [p])[0];
  return phrase.length > 200 ? phrase.slice(0, 199).replace(/\s+\S*$/, '') + '…' : phrase;
}

const blob = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const vecteur = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export class Index {
  constructor(cfg) {
    this.cfg = cfg;
    this.db = ouvrir(cfg.base);
    this.enCours = null;
    this.erreurOllama = null;
    this.verifierModele();
    this.charger();
  }

  meta(cle, valeur) {
    if (valeur === undefined) return this.db.prepare('SELECT valeur FROM meta WHERE cle = ?').get(cle)?.valeur ?? null;
    this.db.prepare('INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur').run(cle, String(valeur));
  }

  // Vectors of another embedding model are not comparable: everything is indexed again
  verifierModele() {
    const ancien = this.meta('modele');
    if (ancien && ancien !== this.cfg.modeleEmbedding) {
      log(`Modèle d'embeddings changé (${ancien} → ${this.cfg.modeleEmbedding}) : réindexation complète`);
      this.vider();
    }
    this.meta('modele', this.cfg.modeleEmbedding);
  }

  vider() {
    this.db.exec('DELETE FROM morceaux; DELETE FROM morceaux_fts; DELETE FROM fichiers;');
  }

  // In-memory vectors, cut to the configured dimensions: ids[i] is the chunk of row i of the matrix
  charger() {
    const lignes = this.db.prepare('SELECT id, vecteur FROM morceaux').all();
    const natif = lignes.length ? lignes[0].vecteur.byteLength / 4 : 0;
    const d = this.cfg.dimensions && this.cfg.dimensions < natif ? this.cfg.dimensions : natif;
    const matrice = new Float32Array(lignes.length * d);
    const ids = new Int32Array(lignes.length);
    const position = new Map();
    lignes.forEach((l, i) => {
      matrice.set(reduire(vecteur(l.vecteur), d), i * d);
      ids[i] = l.id;
      position.set(l.id, i);
    });
    this.memoire = { d, natif, matrice, ids, position };
    this.charge = Date.now();
  }

  retirer(chemin) {
    const ids = this.db.prepare('SELECT id FROM morceaux WHERE chemin = ?').all(chemin);
    const fts = this.db.prepare('DELETE FROM morceaux_fts WHERE rowid = ?');
    for (const { id } of ids) fts.run(id);
    this.db.prepare('DELETE FROM morceaux WHERE chemin = ?').run(chemin);
  }

  enregistrer(f, champs) {
    this.db.prepare(`
      INSERT INTO fichiers (chemin, taille, mtime, empreinte, statut, erreur, type, titre, resume, morceaux, indexe_le)
      VALUES (:chemin, :taille, :mtime, :empreinte, :statut, :erreur, :type, :titre, :resume, :morceaux, :indexe_le)
      ON CONFLICT (chemin) DO UPDATE SET taille = excluded.taille, mtime = excluded.mtime, empreinte = excluded.empreinte,
        statut = excluded.statut, erreur = excluded.erreur, type = excluded.type, titre = excluded.titre,
        resume = excluded.resume, morceaux = excluded.morceaux, indexe_le = excluded.indexe_le
    `).run({
      chemin: f.chemin, taille: f.taille, mtime: f.mtime, empreinte: champs.empreinte ?? null,
      statut: champs.statut, erreur: champs.erreur ?? null, type: champs.type ?? null, titre: champs.titre ?? null,
      resume: champs.resume ?? null, morceaux: champs.morceaux ?? 0, indexe_le: Date.now()
    });
  }

  // Scan of the documents folder. A scan asked for while one runs is done right after it.
  async scanner({ complet = false } = {}) {
    if (complet) this.completDemande = true;
    if (this.enCours) { this.relancer = true; return; }
    this.enCours = { fait: 0, total: 0, fichier: null, debut: Date.now() };
    try {
      do {
        this.relancer = false;
        if (this.completDemande) { this.completDemande = false; this.vider(); log('Réindexation complète'); }
        await this.passe();
      } while (this.relancer || this.completDemande);
    } finally {
      this.enCours = null;
      this.charger();
    }
  }

  async passe() {
    const presents = await lister(this.cfg.racine);
    const connus = new Map(this.db.prepare('SELECT chemin, taille, mtime, empreinte, statut FROM fichiers').all().map((r) => [r.chemin, r]));
    const vus = new Set(presents.map((f) => f.chemin));
    for (const chemin of connus.keys()) {
      if (vus.has(chemin)) continue;
      this.db.exec('BEGIN');
      try {
        this.retirer(chemin);
        this.db.prepare('DELETE FROM fichiers WHERE chemin = ?').run(chemin);
        this.db.exec('COMMIT');
        log(`Retiré : ${chemin}`);
      } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
    const aFaire = presents.filter((f) => {
      const c = connus.get(f.chemin);
      return !c || c.statut === 'attente' || c.taille !== f.taille || c.mtime !== f.mtime;
    });
    this.enCours.total = aFaire.length;
    for (const f of aFaire) {
      this.enCours.fichier = f.chemin;
      try {
        await this.traiter(f, connus.get(f.chemin));
        this.erreurOllama = null;
      } catch (e) {
        if (!(e instanceof ErreurOllama)) {
          // Any other failure is this file's alone: recorded, the others go on
          this.enregistrer(f, { statut: 'erreur', erreur: e.message, empreinte: null });
          log(`Erreur (${e.message}) : ${f.chemin}`);
          continue;
        }
        // Ollama unavailable: this file waits, the next scan (at most 5 min) tries again
        this.erreurOllama = e.message;
        this.enregistrer(f, { statut: 'attente', erreur: e.message, empreinte: null });
        log(`En attente (${e.message}) : ${f.chemin}`);
        break;
      }
      this.enCours.fait++;
      if (Date.now() - this.charge > RECHARGE) this.charger();
    }
    if (aFaire.length || connus.size !== presents.length) this.meta('derniere_indexation', Date.now());
  }

  async traiter(f, connu) {
    const hash = await empreinte(f.abs);
    // Same content (copied, touched): only the date changes
    if (connu && connu.empreinte === hash && connu.statut !== 'attente') {
      this.db.prepare('UPDATE fichiers SET taille = ?, mtime = ? WHERE chemin = ?').run(f.taille, f.mtime, f.chemin);
      return;
    }
    let doc;
    try {
      doc = await extraire(f.abs);
    } catch (e) {
      const ignore = e instanceof FormatNonPrisEnCharge;
      this.db.exec('BEGIN');
      try {
        this.retirer(f.chemin);
        this.enregistrer(f, { statut: ignore ? 'ignore' : 'erreur', erreur: e.message, empreinte: hash });
        this.db.exec('COMMIT');
      } catch (e2) { this.db.exec('ROLLBACK'); throw e2; }
      log(`${ignore ? 'Ignoré' : 'Erreur'} (${e.message}) : ${f.chemin}`);
      return;
    }
    const morceaux = decouper(doc.blocs, { cible: this.cfg.cible, chevauchement: this.cfg.chevauchement });
    if (!morceaux.length) {
      this.retirer(f.chemin);
      this.enregistrer(f, { statut: 'erreur', erreur: 'aucun texte lisible (document scanné ?)', empreinte: hash, type: doc.type, titre: doc.titre });
      log(`Sans texte : ${f.chemin}`);
      return;
    }
    const p = profil(this.cfg.modeleEmbedding);
    const vecteurs = [];
    for (let i = 0; i < morceaux.length; i += LOT) {
      const lot = morceaux.slice(i, i + LOT);
      vecteurs.push(...await vectoriser(this.cfg, lot.map((m) => p.document(m.section ? `${m.section}\n${m.texte}` : m.texte, doc.titre))));
      if (this.enCours) this.enCours.morceaux = `${Math.min(i + LOT, morceaux.length)}/${morceaux.length}`;
    }
    const insererMorceau = this.db.prepare('INSERT INTO morceaux (chemin, rang, page, section, texte, vecteur) VALUES (?, ?, ?, ?, ?, ?)');
    const insererFts = this.db.prepare('INSERT INTO morceaux_fts (rowid, texte, section, titre) VALUES (?, ?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      this.retirer(f.chemin);
      morceaux.forEach((m, rang) => {
        const { lastInsertRowid: id } = insererMorceau.run(f.chemin, rang, m.page, m.section, m.texte, blob(vecteurs[rang]));
        insererFts.run(id, normaliser(m.texte), normaliser(m.section || ''), normaliser(doc.titre));
      });
      this.enregistrer(f, { statut: 'indexe', empreinte: hash, type: doc.type, titre: doc.titre, resume: resumeProvisoire(doc.blocs), morceaux: morceaux.length });
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    if (this.enCours) delete this.enCours.morceaux;
    log(`Indexé (${morceaux.length} morceaux) : ${f.chemin}`);
  }

  // Nearest chunks by cosine (vectors are normalized: a dot product), best first
  plusProches(q, n) {
    const { d, matrice, ids } = this.memoire;
    const top = [];
    for (let i = 0; i < ids.length; i++) {
      let s = 0;
      const o = i * d;
      for (let k = 0; k < d; k++) s += matrice[o + k] * q[k];
      if (top.length < n || s > top[top.length - 1].cos) {
        let j = top.length < n ? top.length : n - 1;
        while (j > 0 && top[j - 1].cos < s) { top[j] = top[j - 1]; j--; }
        top[j] = { id: ids[i], cos: s };
      }
    }
    return top;
  }

  cosinus(q, id) {
    const i = this.memoire.position.get(id);
    if (i === undefined) return null;
    const { d, matrice } = this.memoire;
    let s = 0;
    for (let k = 0; k < d; k++) s += matrice[i * d + k] * q[k];
    return s;
  }

  // BM25 on the normalized text; words of 4 letters or more also match as prefixes (plural forms)
  motsCles(question, n) {
    const mots = motsRequete(question);
    if (!mots.length) return [];
    const requete = mots.map((m) => `"${m}"${m.length >= 4 ? '*' : ''}`).join(' OR ');
    return this.db.prepare('SELECT rowid AS id, bm25(morceaux_fts, 1.0, 0.6, 0.4) AS score FROM morceaux_fts WHERE morceaux_fts MATCH ? ORDER BY score LIMIT ?').all(requete, n);
  }

  // Hybrid search: vectors and keywords fused by RRF. The best raw cosine over all chunks is kept
  // apart: the answer thresholds (lot 3) use it, not the fused score.
  async rechercher(question, { n = this.cfg.extraits, sources = ['documents'] } = {}) {
    const debut = Date.now();
    if (!sources.includes('documents')) return { extraits: [], documents: [], meilleurCosinus: null, duree: 0 };
    let q = null;
    try {
      const [v] = await vectoriser(this.cfg, [profil(this.cfg.modeleEmbedding).requete(question)]);
      q = reduire(v, this.memoire.d || v.length);
    } catch (e) {
      if (!(e instanceof ErreurOllama)) throw e;
      this.erreurOllama = e.message;
    }
    const candidats = this.cfg.candidats;
    const proches = q && this.memoire.d ? this.plusProches(q, candidats) : [];
    const mots = this.motsCles(question, candidats);
    const fusion = new Map();
    const noter = (id, rang, champ) => {
      const f = fusion.get(id) || { id, rrf: 0, rangVecteur: null, rangMots: null };
      f.rrf += 1 / (K_RRF + rang + 1);
      f[champ] = rang + 1;
      fusion.set(id, f);
    };
    proches.forEach((p, i) => noter(p.id, i, 'rangVecteur'));
    mots.forEach((m, i) => noter(m.id, i, 'rangMots'));
    const classes = [...fusion.values()].sort((a, b) => b.rrf - a.rrf);

    const ligne = this.db.prepare(`
      SELECT m.id, m.chemin, m.page, m.section, m.texte, f.titre, f.type, f.resume
      FROM morceaux m JOIN fichiers f ON f.chemin = m.chemin WHERE m.id = ?`);
    const details = (f) => {
      const l = ligne.get(f.id);
      return l && { ...l, rrf: f.rrf, rangVecteur: f.rangVecteur, rangMots: f.rangMots, cosinus: q ? this.cosinus(q, f.id) : null };
    };
    const extraits = [];
    const documents = new Map();
    for (const f of classes) {
      const d = details(f);
      if (!d) continue; // removed since the vectors were loaded
      if (extraits.length < n) extraits.push(d);
      if (!documents.has(d.chemin) && documents.size < 3) {
        documents.set(d.chemin, { chemin: d.chemin, titre: d.titre, type: d.type, resume: d.resume, page: d.page });
      }
      if (extraits.length >= n && documents.size >= 3) break;
    }
    return {
      extraits,
      documents: [...documents.values()],
      meilleurCosinus: proches[0]?.cos ?? null,
      vecteurs: !!q,
      duree: Date.now() - debut
    };
  }

  etat() {
    const compte = Object.fromEntries(this.db.prepare('SELECT statut, COUNT(*) AS n FROM fichiers GROUP BY statut').all().map((r) => [r.statut, r.n]));
    const derniere = this.meta('derniere_indexation');
    return {
      documents: compte.indexe || 0,
      morceaux: this.db.prepare('SELECT COUNT(*) AS n FROM morceaux').get().n,
      enAttente: compte.attente || 0,
      problemes: this.db.prepare("SELECT chemin, statut, erreur FROM fichiers WHERE statut IN ('erreur', 'ignore', 'attente') ORDER BY chemin LIMIT 200").all(),
      derniereIndexation: derniere ? Number(derniere) : null,
      enCours: this.enCours,
      modele: this.cfg.modeleEmbedding,
      dimensions: this.memoire.d,
      dimensionsNatives: this.memoire.natif,
      memoireVecteurs: this.memoire.matrice.byteLength,
      erreurOllama: this.erreurOllama
    };
  }
}

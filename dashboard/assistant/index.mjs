import { DatabaseSync } from 'node:sqlite';
import { promises as fs, createReadStream } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { extraire, FormatNonPrisEnCharge } from './extraction.mjs';
import { decouper } from './decoupage.mjs';
import { profil, reduire, vectoriser } from './embeddings.mjs';
import { ErreurOllama } from './ollama.mjs';
import { completer } from './generation.mjs';
import { messagesResume } from './prompt.mjs';
import { classer, noterCouverture } from './bm25.mjs';
import { termePrincipal } from './terme.mjs';
import { passagesWikis } from './wikis.mjs';
import { passagesLivres } from './source-livres.mjs';
import { normaliser, motsRequete } from '../lib/normalisation.mjs';

// Index of the personal documents: files, chunks, full-text index (FTS5) and vectors (Float32 BLOB,
// loaded in memory, cosine in JS). Runs in the assistant's worker thread, never on Next's event loop.

const LOT = 8;          // chunks per embedding call (cfg.lot)
const RECHARGE = 30000; // at most every 30 s during a long indexing, the in-memory vectors are refreshed
const K_RRF = 60;
// Raised whenever the extraction or the chunking changes: the index is rebuilt at the next start
const VERSION_EXTRACTION = 3;
const PAUSE_MAX = 5 * 60 * 1000; // a pause never forgotten: resumed at the latest after 5 min
const PDF_VIDE = 30;             // fewer letters per page on average: a scanned PDF

// Reason given to the indexing call cut short by a question
class Pause extends Error {}

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
    -- Conversations of the assistant. One password, one household: no user here.
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY, titre TEXT NOT NULL, cree INTEGER NOT NULL, modifie INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, conversation INTEGER NOT NULL, role TEXT NOT NULL, texte TEXT NOT NULL,
      sources TEXT, issue INTEGER, quand INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation);
  `);
  // Added in lot 3: 1 once the language model has written the summary (0 = first sentence only)
  if (!db.prepare('PRAGMA table_info(fichiers)').all().some((c) => c.name === 'resume_modele')) {
    db.exec('ALTER TABLE fichiers ADD COLUMN resume_modele INTEGER NOT NULL DEFAULT 0');
  }
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
    this.pauses = new Map();   // questions in progress: the indexing waits for them
    this.reveils = [];
    this.appelIndexation = null;
    this.jetons = 0;
    this.verifierModele();
    this.charger();
  }

  meta(cle, valeur) {
    if (valeur === undefined) return this.db.prepare('SELECT valeur FROM meta WHERE cle = ?').get(cle)?.valeur ?? null;
    this.db.prepare('INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur').run(cle, String(valeur));
  }

  // A question takes priority: the indexing call in flight is cut (redone after), and no new one
  // starts until every question has been answered
  suspendre(duree = PAUSE_MAX) {
    const jeton = ++this.jetons;
    this.pauses.set(jeton, setTimeout(() => this.reprendre(jeton), duree));
    this.appelIndexation?.abort(new Pause());
    return jeton;
  }

  reprendre(jeton) {
    clearTimeout(this.pauses.get(jeton));
    this.pauses.delete(jeton);
    if (!this.pauses.size) this.reveils.splice(0).forEach((r) => r());
  }

  // A background call to Ollama that gives way to questions: cut if one arrives, redone after it
  async avecPriorite(appel) {
    for (;;) {
      while (this.pauses.size) await new Promise((r) => this.reveils.push(r));
      this.appelIndexation = new AbortController();
      try {
        return await appel(this.appelIndexation.signal);
      } catch (e) {
        if (!(e instanceof Pause)) throw e;
      } finally {
        this.appelIndexation = null;
      }
    }
  }

  // Vectors of another embedding model are not comparable, and a better extraction changes the
  // chunks: in both cases everything is indexed again
  verifierModele() {
    const ancien = this.meta('modele');
    const version = this.meta('extraction');
    if (ancien && ancien !== this.cfg.modeleEmbedding) {
      log(`Modèle d'embeddings changé (${ancien} → ${this.cfg.modeleEmbedding}) : réindexation complète`);
      this.vider();
    } else if (ancien && version !== String(VERSION_EXTRACTION)) {
      log(`Extraction améliorée (version ${VERSION_EXTRACTION}) : réindexation complète`);
      this.vider();
    }
    this.meta('modele', this.cfg.modeleEmbedding);
    this.meta('extraction', VERSION_EXTRACTION);
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
        resume = excluded.resume, morceaux = excluded.morceaux, indexe_le = excluded.indexe_le, resume_modele = 0
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
        if (!this.relancer && !this.completDemande) await this.resumer();
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
    let modifie = false;
    for (const chemin of connus.keys()) {
      if (vus.has(chemin)) continue;
      this.db.exec('BEGIN');
      try {
        this.retirer(chemin);
        this.db.prepare('DELETE FROM fichiers WHERE chemin = ?').run(chemin);
        this.db.exec('COMMIT');
        log(`Retiré : ${chemin}`);
        modifie = true;
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
        modifie = true;
      } catch (e) {
        if (!(e instanceof ErreurOllama)) {
          // Any other failure is this file's alone: recorded, the others go on
          this.enregistrer(f, { statut: 'probleme', erreur: e.message, empreinte: null });
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
    if (modifie) this.meta('derniere_indexation', Date.now());
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
        this.enregistrer(f, { statut: ignore ? 'ignore' : 'probleme', erreur: e.message, empreinte: hash });
        this.db.exec('COMMIT');
      } catch (e2) { this.db.exec('ROLLBACK'); throw e2; }
      log(`${ignore ? 'Ignoré' : 'Erreur'} (${e.message}) : ${f.chemin}`);
      return;
    }
    const morceaux = decouper(doc.blocs, { cible: this.cfg.cible, chevauchement: this.cfg.chevauchement });
    const lettres = doc.blocs.reduce((n, b) => n + (b.texte.match(/\p{L}/gu)?.length || 0), 0);
    const vide = !morceaux.length || (doc.type === 'pdf' && lettres / (doc.pages || 1) < PDF_VIDE);
    if (vide) {
      this.retirer(f.chemin);
      const motif = doc.type === 'pdf' ? 'PDF sans texte (probablement scanné)' : 'aucun texte lisible';
      this.enregistrer(f, { statut: 'probleme', erreur: motif, empreinte: hash, type: doc.type, titre: doc.titre });
      log(`${motif} : ${f.chemin}`);
      return;
    }
    const p = profil(this.cfg.modeleEmbedding);
    const vecteurs = [];
    const taille = this.cfg.lot || LOT;
    for (let i = 0; i < morceaux.length; i += taille) {
      const lot = morceaux.slice(i, i + taille);
      const textes = lot.map((m) => p.document(m.section ? `${m.section}\n${m.texte}` : m.texte, doc.titre));
      vecteurs.push(...await this.avecPriorite((signal) => vectoriser(this.cfg, textes, signal)));
      if (this.enCours) this.enCours.morceaux = `${Math.min(i + taille, morceaux.length)}/${morceaux.length}`;
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

  // One-line summaries written by the language model, once the documents are searchable. Without
  // the model (not installed, Ollama down), the first sentence stays and the next scan tries again.
  async resumer() {
    if (!this.cfg.modeleChat) return;
    const aFaire = this.db.prepare("SELECT chemin, titre FROM fichiers WHERE statut = 'indexe' AND resume_modele = 0").all();
    const debutTexte = this.db.prepare('SELECT texte FROM morceaux WHERE chemin = ? ORDER BY rang LIMIT 3');
    for (const f of aFaire) {
      if (this.relancer || this.completDemande) return; // new files first
      if (this.enCours) this.enCours.fichier = `résumé : ${f.chemin}`;
      const debut = debutTexte.all(f.chemin).map((m) => m.texte).join('\n\n').slice(0, 1500);
      let resume;
      try {
        resume = await this.avecPriorite((signal) => completer(this.cfg, messagesResume(f.titre, debut), { temperature: 0.2, signal }));
      } catch (e) {
        log(`Résumés remis à plus tard (${e.message})`);
        return;
      }
      // Small models tend to start with « Document « titre » : »
      resume = resume.split('\n')[0].replace(/^(document\s*)?«[^»]*»\s*[:–—-]\s*/i, '').replace(/^["«\s]+|["»\s]+$/g, '').slice(0, 300);
      resume = resume.charAt(0).toUpperCase() + resume.slice(1);
      if (resume) this.db.prepare('UPDATE fichiers SET resume = ?, resume_modele = 1 WHERE chemin = ?').run(resume, f.chemin);
    }
  }

  // Conversations: kept in the same base, next to the index. A reindexing never touches them.
  conversations() {
    return this.db.prepare('SELECT id, titre, cree, modifie FROM conversations ORDER BY modifie DESC LIMIT 200').all();
  }

  conversation(id) {
    const c = this.db.prepare('SELECT id, titre, cree, modifie FROM conversations WHERE id = ?').get(Number(id));
    if (!c) return null;
    const messages = this.db.prepare('SELECT id, role, texte, sources, issue, quand FROM messages WHERE conversation = ? ORDER BY id').all(c.id);
    return { ...c, messages: messages.map((m) => ({ ...m, sources: m.sources ? JSON.parse(m.sources) : [] })) };
  }

  // An exchange is written once the answer is finished: an empty conversation is never saved.
  // The title is the beginning of the first question, without any call to the model.
  ajouterEchange({ conversation, question, reponse, sources = [], issue = null }) {
    const maintenant = Date.now();
    let id = Number(conversation) || null;
    if (id && !this.db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(id)) id = null;
    if (!id) {
      const titre = question.replace(/\s+/g, ' ').trim().slice(0, 50) || 'Sans titre';
      id = Number(this.db.prepare('INSERT INTO conversations (titre, cree, modifie) VALUES (?, ?, ?)').run(titre, maintenant, maintenant).lastInsertRowid);
    } else {
      this.db.prepare('UPDATE conversations SET modifie = ? WHERE id = ?').run(maintenant, id);
    }
    const inserer = this.db.prepare('INSERT INTO messages (conversation, role, texte, sources, issue, quand) VALUES (?, ?, ?, ?, ?, ?)');
    inserer.run(id, 'question', question, null, null, maintenant);
    inserer.run(id, 'reponse', reponse, JSON.stringify(sources), issue, Date.now());
    return this.conversation(id);
  }

  renommerConversation(id, titre) {
    const t = String(titre || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!t) throw new Error('Titre vide');
    this.db.prepare('UPDATE conversations SET titre = ? WHERE id = ?').run(t, Number(id));
    return this.conversations();
  }

  supprimerConversation(id) {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM messages WHERE conversation = ?').run(Number(id));
      this.db.prepare('DELETE FROM conversations WHERE id = ?').run(Number(id));
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return this.conversations();
  }

  viderConversations() {
    this.db.exec('DELETE FROM messages; DELETE FROM conversations;');
    return [];
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

  // Personal documents: vectors and keywords fused by RRF (weighted). The best raw cosine over all
  // chunks is kept apart: the answer thresholds use it, not the fused score.
  documentsProches(q, question, n) {
    const candidats = this.cfg.candidats;
    const proches = q && this.memoire.d ? this.plusProches(q, candidats) : [];
    const mots = this.motsCles(question, candidats);
    const fusion = new Map();
    const noter = (id, rang, champ, poids) => {
      const f = fusion.get(id) || { id, rrf: 0, rangVecteur: null, rangMots: null };
      f.rrf += poids / (K_RRF + rang + 1);
      f[champ] = rang + 1;
      fusion.set(id, f);
    };
    proches.forEach((p, i) => noter(p.id, i, 'rangVecteur', 1));
    mots.forEach((m, i) => noter(m.id, i, 'rangMots', this.cfg.poidsMots ?? 1));
    const classes = [...fusion.values()].sort((a, b) => b.rrf - a.rrf);
    const ligne = this.db.prepare(`
      SELECT m.id, m.chemin, m.page, m.section, m.texte, f.titre, f.type, f.resume
      FROM morceaux m JOIN fichiers f ON f.chemin = m.chemin WHERE m.id = ?`);
    const extraits = [];
    const documents = new Map();
    for (const f of classes) {
      const l = ligne.get(f.id);
      if (!l) continue; // removed since the vectors were loaded
      const d = { ...l, origine: 'documents', source: 'Mes documents', rrf: f.rrf, rangVecteur: f.rangVecteur, rangMots: f.rangMots, cosinus: q ? this.cosinus(q, f.id) : null };
      if (extraits.length < n) extraits.push(d);
      if (!documents.has(d.chemin) && documents.size < 3) {
        documents.set(d.chemin, { origine: 'documents', source: 'Mes documents', chemin: d.chemin, titre: d.titre, type: d.type, resume: d.resume, page: d.page, cosinus: d.cosinus });
      }
      if (extraits.length >= n && documents.size >= 3) break;
    }
    return { extraits, documents: [...documents.values()], meilleur: proches[0]?.cos ?? null };
  }

  // Search in every source. Documents: the index above. Wikis (Kiwix) and books: their passages are
  // fetched while the question is embedded, sorted by a local BM25 on both queries (keywords and
  // main term), and only the best ones get an embedding (8 wiki, 4 book paragraphs: CPU time).
  // Common ranking by cosine (same model, same prefixes). garder: the indexing stays paused after the
  // search (until reprendre(jeton), when the answer is written); otherwise it resumes right away.
  async rechercher(question, { n = this.cfg.extraits, sources = ['documents'], garder = false, requetes } = {}) {
    const debut = Date.now();
    const durees = {};
    const mesurer = (nom, promesse) => {
      const t = Date.now();
      return promesse.then((v) => { durees[nom] = Date.now() - t; return v; }, (e) => {
        durees[nom] = Date.now() - t;
        log(`Source ${nom} indisponible : ${e.message}`);
        return [];
      });
    };
    const req = (requetes?.length ? requetes : [question]).filter(Boolean);
    const pWikis = sources.includes('wikis') ? mesurer('wikis', passagesWikis(req, { articles: this.cfg.articlesWiki || 15 })) : Promise.resolve([]);
    const pLivres = sources.includes('livres') ? mesurer('livres', passagesLivres(req)) : Promise.resolve([]);

    const jeton = this.suspendre();
    const prof = profil(this.cfg.modeleEmbedding);
    let q = null;
    try {
      const t = Date.now();
      // The rewritten question for the vectors, the keyword queries for FTS5, Kiwix and BM25
      const [v] = await vectoriser(this.cfg, [prof.requete(question)]);
      q = reduire(v, this.memoire.d || v.length);
      durees.requete = Date.now() - t;
    } catch (e) {
      if (!(e instanceof ErreurOllama)) { this.reprendre(jeton); throw e; }
      this.erreurOllama = e.message;
    }

    const docs = sources.includes('documents') ? this.documentsProches(q, req.join(' '), n) : { extraits: [], documents: [], meilleur: null };
    const [wikis, livres] = await Promise.all([pWikis, pLivres]);
    // Main term: the one of the understanding step when each of its words comes from the question,
    // otherwise the rarest word of the question among the passages found. Without a sure term, the
    // title and section rules do not apply at all.
    const tous = [...wikis, ...livres];
    const frequence = (mot) => tous.filter((p) => normaliser(`${p.titre} ${p.section} ${p.texte}`).includes(mot)).length;
    const principal = termePrincipal(requetes?.[1], question, frequence);
    const externes = [...classer(wikis, req, 8, { terme: principal.terme }), ...classer(livres, req, 4, { terme: principal.terme })];
    if (q && externes.length) {
      const t = Date.now();
      try {
        const vs = await vectoriser(this.cfg, externes.map((p) => prof.document(p.section ? `${p.section}\n${p.texte}` : p.texte, p.titre)));
        externes.forEach((p, i) => {
          const v = reduire(vs[i], q.length);
          let c = 0;
          for (let k = 0; k < q.length; k++) c += v[k] * q[k];
          p.cosinus = c;
        });
      } catch (e) {
        if (!(e instanceof ErreurOllama)) { this.reprendre(jeton); throw e; }
      }
      durees.vecteurs = Date.now() - t;
    }
    if (!garder) this.reprendre(jeton);

    const meilleur = (origine) => externes.filter((p) => p.origine === origine && p.cosinus != null).reduce((m, p) => Math.max(m, p.cosinus), -1);
    const meilleurs = {
      documents: docs.meilleur,
      wikis: wikis.length ? Math.max(meilleur('wiki'), -1) : null,
      livres: livres.length ? Math.max(meilleur('livre'), -1) : null
    };
    for (const k of ['wikis', 'livres']) if (meilleurs[k] === -1) meilleurs[k] = null;
    // Share of the query found in each passage: shown in debug, and the ranking itself when the
    // question could not be embedded (Ollama down): keywords only, on a common scale
    noterCouverture([...docs.extraits, ...externes], req);
    const note = (p) => (q ? p.cosinus ?? -1 : p.couverture ?? 0);
    const extraits = [...docs.extraits, ...externes.filter((p) => !q || p.cosinus != null)]
      .sort((a, b) => note(b) - note(a))
      .slice(0, n);
    // The best keyword match of the documents keeps its place: an exact reference or code can have
    // a low cosine
    const exact = docs.extraits.find((e) => e.rangMots === 1);
    if (exact && !extraits.includes(exact)) extraits.splice(extraits.length - 1, 1, exact);
    // Closest items for outcome 2: documents with their summary, wiki articles and book pages
    // One card per document: a summary that says what it is about, never its text (outcome 2 must
    // not answer). Books are grouped by book, with the page of their best passage.
    const vus = new Set();
    const proches = [...docs.documents, ...externes.filter((p) => p.cosinus != null).map((p) => ({
      origine: p.origine, source: p.source, guide: p.guide, titre: p.titre, type: p.origine === 'wiki' ? 'article' : 'livre',
      resume: p.origine === 'wiki' ? `article du wiki${p.section ? `, section « ${p.section} »` : ''}` : `livre${p.section ? `, chapitre « ${p.section} »` : ''}`,
      lien: p.lien, page: p.page, cosinus: p.cosinus
    }))].sort((a, b) => (b.cosinus ?? -1) - (a.cosinus ?? -1)).filter((d) => {
      const cle = d.origine === 'documents' ? d.chemin : d.origine === 'livre' ? `livre:${d.source}` : d.lien;
      if (vus.has(cle)) return false;
      vus.add(cle);
      return true;
    }).slice(0, 3);
    const valeurs = Object.values(meilleurs).filter((v) => v != null);
    return {
      extraits,
      documents: proches,
      meilleurs,
      meilleurCosinus: valeurs.length ? Math.max(...valeurs) : null,
      terme: principal,
      vecteurs: !!q,
      durees: { ...durees, total: Date.now() - debut },
      duree: Date.now() - debut,
      ...(garder ? { jeton } : {})
    };
  }

  etat() {
    const compte = Object.fromEntries(this.db.prepare('SELECT statut, COUNT(*) AS n FROM fichiers GROUP BY statut').all().map((r) => [r.statut, r.n]));
    const derniere = this.meta('derniere_indexation');
    return {
      documents: compte.indexe || 0,
      morceaux: this.db.prepare('SELECT COUNT(*) AS n FROM morceaux').get().n,
      enAttente: compte.attente || 0,
      problemes: this.db.prepare("SELECT chemin, statut, erreur FROM fichiers WHERE statut IN ('probleme', 'ignore', 'attente') ORDER BY chemin LIMIT 200").all(),
      enPause: this.pauses.size > 0,
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

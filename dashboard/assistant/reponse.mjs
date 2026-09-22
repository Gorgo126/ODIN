import { discuter } from './generation.mjs';
import { comprendre } from './comprehension.mjs';
import { messagesReponse, messagesProches, remplacer, etiquette } from './prompt.mjs';

// Answer pipeline of the assistant, as a stream of events:
//   { type: 'etat', etat: 'comprehension' | 'recherche' | 'redaction' }
//   { type: 'texte', texte }              pieces of the answer, in order
//   { type: 'fin', issue: 0 | 1 | 2 | 3, ... } sources, documents, timings, debug
//   { type: 'erreur', message }
// 1. Understanding (short call, strict JSON): a conversation gets a short reply, no search (issue 0).
// 2. Search in the personal documents, the wikis (Kiwix) and the books, with the rewritten queries.
// 3. The outcome is decided from the best raw cosine of each source, BEFORE any other model call:
//    1 one source ≥ its answer threshold: answer written from the passages ([NON_TROUVE] → 2)
//    2 one source ≥ its « close » threshold: 1 or 2 sentences on the closest items, never an answer
//    3 below: a « don't know » sentence from the settings, no model call.
// rechercher(question, { n, garder, requetes, sources }) and reprendre(jeton) come from the index.

const SEUILS = { documents: 'documents', wiki: 'wikis', livre: 'livres' };
const seuil = (reglages, e) => reglages.seuils[SEUILS[e.origine] || 'documents'];

// Where a source opens: personal PDFs in the viewer at the right page, other personal files as they
// are, wiki articles in ODIN's reader, books in their viewer (links built by the source)
export function lienDocument(chemin, page) {
  if (/\.pdf$/i.test(chemin)) return `/assistant/document?chemin=${encodeURIComponent(chemin)}${page ? `&page=${page}` : ''}`;
  return `/fichiers-documents/${chemin.split('/').map(encodeURIComponent).join('/')}`;
}
const lien = (e) => e.lien || lienDocument(e.chemin, e.page);

// Could the start of the answer still be the [NON_TROUVE] marker? (with or without brackets)
function marqueur(debut) {
  const n = debut.trimStart().replace(/^\[/, '').toUpperCase();
  if (n.startsWith('NON_TROUV') || n.startsWith('NON TROUV')) return 'oui';
  return n.length < 10 && ('NON_TROUVE'.startsWith(n) || 'NON TROUVE'.startsWith(n)) ? 'peut-etre' : 'non';
}

// Outcome 2 must never answer: a number that is neither in the question nor in the titles and
// summaries was invented. The text is then replaced by a plain sentence listing the items.
function sansInvention(texte, documents, question) {
  const permis = new Set(`${question} ${documents.map((d) => `${d.titre} ${d.resume || ''}`).join(' ')}`.match(/\d+/g) || []);
  return (texte.match(/\d+/g) || []).every((n) => permis.has(n)) && !/\[/.test(texte);
}

function repliProches(reglages, documents) {
  const tu = reglages.personnalite.tutoiement;
  const noms = documents.map((d) => `« ${d.titre} »`);
  const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}` : noms[0];
  const cherche = tu ? 'Tu y trouveras peut-être de quoi avancer.' : 'Vous y trouverez peut-être de quoi avancer.';
  return `Je n'ai pas trouvé de réponse exacte, mais ${noms.length > 1 ? 'ces sources s\'en rapprochent' : 'cette source s\'en rapproche'} : ${liste}. ${cherche}`;
}

// Only the passages close to the best one reach the model: an off-topic passage misleads a small
// model (an amount taken from the wrong document) and costs about 4 s of reading on CPU. Kept:
// cosine within ECART of the best usable passage, or among the first two by keywords in the
// documents; a passage whose source is below its « close » threshold is dropped.
const ECART = 0.1;
function utiles(extraits, reglages) {
  const valables = extraits.filter((e) => (e.cosinus ?? -1) >= seuil(reglages, e).proches);
  if (!valables.length) return [];
  const meilleur = Math.max(...valables.map((e) => e.cosinus));
  return valables.filter((e) => e.cosinus >= meilleur - ECART || (e.rangMots && e.rangMots <= 2));
}

function sources(texte, extraits) {
  const cites = [...new Set([...texte.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))].filter((n) => n >= 1 && n <= extraits.length);
  const renvois = Object.fromEntries(cites.map((n) => {
    const e = extraits[n - 1];
    return [n, { titre: e.titre, etiquette: etiquette(e), page: e.page, lien: lien(e) }];
  }));
  // Cited items first, then the other passages the answer was written from
  const liste = new Map();
  for (const e of [...cites.map((n) => extraits[n - 1]), ...extraits]) {
    const cle = e.origine === 'documents' ? e.chemin : e.origine === 'wiki' ? e.lien : e.source;
    const s = liste.get(cle) || { origine: e.origine, etiquette: etiquette(e), titre: e.titre, chemin: e.chemin, type: e.type, pages: [], lien: lien(e) };
    if (e.page && !s.pages.includes(e.page)) s.pages.push(e.page);
    liste.set(cle, s);
  }
  return { renvois, sources: [...liste.values()] };
}

// Health or safety question: the 112 reminder is always there, whatever the model wrote
const rappel112 = (reglages) => (reglages.personnalite.tutoiement ? 'En cas de signe de gravité, appelle le 112.' : 'En cas de signe de gravité, appelez le 112.');

export async function* repondre({ question, historique = [], reglages, cfg, rechercher, reprendre, signal, sources: parmi = ['documents', 'wikis', 'livres'] }) {
  const debut = Date.now();
  const durees = {};
  const options = { temperature: reglages.temperature, signal };
  const premier = () => { durees.premierMot ??= Date.now() - debut; };

  yield { type: 'etat', etat: 'comprehension' };
  const c = await comprendre(cfg, reglages, question, reglages.memoire ? historique : [], signal);
  durees.comprehension = Date.now() - debut;

  if (c.type === 'conversation') {
    // No search, no fact: a reply with a figure in it is replaced by a neutral one
    const tu = reglages.personnalite.tutoiement;
    const texte = c.reponse && !/\d/.test(c.reponse) ? c.reponse : (tu ? 'Avec plaisir ! Pose-moi une question quand tu veux.' : 'Avec plaisir ! Posez-moi une question quand vous voulez.');
    premier();
    yield { type: 'texte', texte };
    durees.total = Date.now() - debut;
    yield { type: 'fin', issue: 0, comprehension: c, renvois: {}, sources: [], documents: [], durees };
    return;
  }

  yield { type: 'etat', etat: 'recherche' };
  let r;
  try {
    r = await rechercher(c.question, { n: reglages.extraits, garder: true, requetes: [c.requete, c.terme], sources: parmi });
  } catch (e) {
    yield { type: 'erreur', message: `Recherche impossible : ${e.message}` };
    return;
  }
  durees.recherche = Date.now() - debut;
  durees.sources = r.durees;

  try {
    if (!r.vecteurs) {
      yield { type: 'erreur', message: 'Le moteur d\'IA ne répond pas pour le moment : réessaie dans un instant.' };
      return;
    }
    const niveaux = Object.entries(r.meilleurs).filter(([, m]) => m != null);
    let issue = niveaux.some(([s, m]) => m >= reglages.seuils[s].reponse) ? 1 : niveaux.some(([s, m]) => m >= reglages.seuils[s].proches) ? 2 : 3;
    let texte = '';
    const extraits = utiles(r.extraits, reglages);
    if (issue === 1 && !extraits.length) issue = 2;

    if (issue === 1) {
      yield { type: 'etat', etat: 'redaction' };
      let tampon = '';
      let decide = false;
      for await (const t of discuter(cfg, messagesReponse(reglages, extraits, c.question), options)) {
        if (decide) { texte += t; yield { type: 'texte', texte: t }; continue; }
        tampon += t;
        const m = marqueur(tampon);
        if (m === 'peut-etre') continue;
        if (m === 'oui') { issue = 2; break; } // leaving the loop closes the stream: Ollama stops
        decide = true;
        texte = tampon.trimStart();
        premier();
        yield { type: 'texte', texte };
      }
      if (!decide && issue === 1) {
        if (!tampon.trim()) issue = 2;
        else { texte = tampon.trim(); premier(); yield { type: 'texte', texte }; }
      }
    }

    // Closest items: those of a source above its « close » threshold, the best one at least
    let documents = [];
    if (issue === 2) {
      documents = r.documents.filter((d, i) => i === 0 || (d.cosinus ?? -1) >= seuil(reglages, d).proches);
      if (!documents.length) issue = 3;
    }
    if (issue === 2) {
      // Short text (1 or 2 sentences), checked as a whole before it is shown
      yield { type: 'etat', etat: 'redaction' };
      for await (const t of discuter(cfg, messagesProches(reglages, documents, c.question), options)) texte += t;
      texte = texte.trim();
      if (!texte || !sansInvention(texte, documents, c.question)) texte = repliProches(reglages, documents);
      premier();
      yield { type: 'texte', texte };
    }

    if (issue === 3) {
      const phrases = reglages.jeNeSaisPas;
      texte = remplacer(phrases[Math.floor(Math.random() * phrases.length)], reglages);
      premier();
      yield { type: 'texte', texte };
    }

    if (c.sante && !/\b112\b/.test(texte)) {
      const ajout = `\n\n${rappel112(reglages)}`;
      texte += ajout;
      yield { type: 'texte', texte: ajout };
    }

    durees.total = Date.now() - debut;
    yield {
      type: 'fin',
      issue,
      comprehension: c,
      ...(issue === 1 ? sources(texte, extraits) : { renvois: {}, sources: [] }),
      documents: documents.map((d) => ({ origine: d.origine, etiquette: etiquette(d), titre: d.titre, type: d.type, chemin: d.chemin, lien: lien(d) })),
      meilleurs: r.meilleurs,
      meilleurCosinus: r.meilleurCosinus,
      durees,
      ...(reglages.debug ? {
        debug: {
          seuils: reglages.seuils,
          extraits: r.extraits.map((e) => ({ origine: e.origine, source: e.source, titre: e.titre, chemin: e.chemin, page: e.page, section: e.section, texte: e.texte, cosinus: e.cosinus, rrf: e.rrf, rangVecteur: e.rangVecteur, rangMots: e.rangMots, bm25: e.bm25, envoye: extraits.includes(e) })),
          documentsProches: r.documents
        }
      } : {})
    };
  } catch (e) {
    if (signal?.aborted) return;
    yield { type: 'erreur', message: e.message };
  } finally {
    if (r?.jeton) await reprendre(r.jeton);
  }
}

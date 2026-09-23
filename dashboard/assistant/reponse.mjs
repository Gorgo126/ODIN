import { discuter } from './generation.mjs';
import { comprendre } from './comprehension.mjs';
import { messagesReponse, messagesProches, remplacer, etiquette, titreSource } from './prompt.mjs';
import { conversation, reponseConversation } from './conversation.mjs';
import { besoinDeContexte, reformulationFiable } from './contexte.mjs';
import { signeDeGravite, messageUrgence, estGuide } from './securite.mjs';
import { lien, cleSource } from './passages.mjs';

export { lienDocument } from './passages.mjs';

// Answer pipeline of the assistant, as a stream of events:
//   { type: 'etat', etat: 'comprehension' | 'recherche' | 'redaction' }
//   { type: 'texte', texte }              pieces of the answer, in order
//   { type: 'fin', issue: 0 | 1 | 2 | 3, ... } sources, documents, timings, debug
//   { type: 'erreur', message }
// 0. A conversation (« salut », « merci ») is recognised by fixed rules: short reply, no call at all.
// 1. Understanding (short call, strict JSON): standalone question, search queries, health flags.
// 2. Search in the personal documents, the wikis (Kiwix) and the books, with the rewritten queries.
// 3. The outcome is decided from the best raw cosine of each source, BEFORE any other model call:
//    1 one source ≥ its answer threshold: answer written from the passages ([NON_TROUVE] → 2)
//    2 one source ≥ its « close » threshold: 1 or 2 sentences on the closest items, never an answer
//    3 below: a « don't know » sentence from the settings, no model call.
// rechercher(question, { n, garder, requetes, sources }) and reprendre(jeton) come from the index.

const SEUILS = { documents: 'documents', wiki: 'wikis', livre: 'livres' };
const seuil = (reglages, e) => reglages.seuils[SEUILS[e.origine] || 'documents'];

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
  const liste = documents.map((d) => titreSource({ ...d, pages: d.page ? [d.page] : [] })).join(' ; ');
  const cherche = tu ? 'Tu y trouveras peut-être de quoi avancer.' : 'Vous y trouverez peut-être de quoi avancer.';
  return `Je n'ai pas trouvé de réponse précise. ${documents.length > 1 ? 'Ces sources s\'en rapprochent' : 'Cette source s\'en rapproche'} : ${liste}. ${cherche}`;
}

// Only the passages close to the best one reach the model: an off-topic passage misleads a small
// model (an amount taken from the wrong document) and costs about 4 s of reading on CPU. Kept:
// cosine within ECART of the best usable passage, the best keyword match of the documents, and the
// best passage of every source above its answer threshold (a question covered by the documents
// and by a wiki gets both). A passage whose source is below its « close » threshold is dropped.
const ECART = 0.1;
const DELAI_RESEAU = 500; // the probe never delays an answer: after that, « unknown » wording
function utiles(extraits, reglages, urgence = false) {
  const valables = extraits.filter((e) => (e.cosinus ?? -1) >= seuil(reglages, e).proches);
  if (!valables.length) return [];
  const meilleur = Math.max(...valables.map((e) => e.cosinus));
  const premiers = new Set(Object.keys(SEUILS).map((o) => valables.filter((e) => e.origine === o)
    .sort((a, b) => b.cosinus - a.cosinus)[0]).filter((e) => e && e.cosinus >= seuil(reglages, e).reponse));
  // Emergency: the best passage of a medical guide always goes with it, even a little below the
  // answer threshold — the guide is what remains when no one can be reached
  if (urgence) {
    const guide = valables.filter(estGuide).sort((a, b) => b.cosinus - a.cosinus)[0];
    if (guide) premiers.add(guide);
  }
  return valables.filter((e) => e.cosinus >= meilleur - ECART || e.rangMots === 1 || premiers.has(e));
}

// The model numbers the passages; the reader needs sources. Passages of the same document become
// one source, numbered in the order they are cited, and the references of the answer are renumbered
// ([1] [2] …, no gap). Only the cited sources are listed.

function sources(texte, extraits) {
  const groupes = new Map();
  extraits.forEach((e, i) => {
    const cle = cleSource(e);
    const g = groupes.get(cle) || { origine: e.origine, etiquette: etiquette(e), titre: e.titre, chemin: e.chemin, type: e.type, pages: [], lien: lien(e), extraits: [] };
    if (e.page && !g.pages.includes(e.page)) g.pages.push(e.page);
    g.extraits.push(i + 1);
    groupes.set(cle, g);
  });
  const numero = new Map();
  [...texte.matchAll(/\[(\d+)\]/g)].forEach(([, n]) => {
    const e = extraits[Number(n) - 1];
    if (!e) return;
    const cle = cleSource(e);
    if (!numero.has(cle)) numero.set(cle, numero.size + 1);
  });
  const texteFinal = texte.replace(/\s*\[(\d+)\]/g, (m, n) => {
    const e = extraits[Number(n) - 1];
    return e && numero.has(cleSource(e)) ? ` [${numero.get(cleSource(e))}]` : '';
  });
  const sources = [...numero.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([cle, n]) => {
      const g = groupes.get(cle);
      return { n, origine: g.origine, etiquette: g.etiquette, titre: g.titre, chemin: g.chemin, type: g.type, pages: g.pages, lien: g.lien, libelle: titreSource(g) };
    });
  const renvois = Object.fromEntries(sources.map((s) => [s.n, { titre: s.titre, etiquette: s.etiquette, libelle: s.libelle, page: s.pages[0], lien: s.lien }]));
  return { texte: texteFinal, renvois, sources };
}

// Outcome 2 must not answer, even in passing: anything that looks like an answer (a cause, an
// advice, an order, a guess) sends us back to the fixed sentence
const REPONSE = /\b(il (faut|suffit|s agit)|tu (dois|peux|devrais)|vous (devez|pouvez|devriez)|essaie|essayez|prends|prenez|applique|appliquez|mets|mettez|consulte|consultez|peut[- ]etre|probablement|sans doute|souvent du? |cause|symptome|remede|traitement|migraine|crise|maladie|dose|medicament)/i;
function ressembleAUneReponse(texte, documents) {
  if (texte.length > 400 || (texte.match(/[.!?]/g) || []).length > 3) return true;
  if (REPONSE.test(texte)) return true;
  // Every sentence but the first must talk about the documents
  const phrases = texte.split(/(?<=[.!?])\s+/).slice(1);
  const noms = documents.flatMap((d) => `${d.titre} ${d.resume || ''}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)).filter((m) => m.length > 4);
  return phrases.some((p) => {
    const bas = p.toLowerCase();
    return !/document|article|wiki|livre|fiche|page|relev|contrat|notice|carnet|facture/.test(bas) && !noms.some((m) => bas.includes(m));
  });
}

export async function* repondre({ question, historique = [], reglages, cfg, rechercher, reprendre, reseau, signal, sources: parmi = ['documents', 'wikis', 'livres'] }) {
  const debut = Date.now();
  const durees = {};
  const options = { temperature: reglages.temperature, signal };
  const premier = () => { durees.premierMot ??= Date.now() - debut; };

  // « salut », « merci » : fixed rules, no call at all (« comment faire du feu ? » is a question)
  const categorie = conversation(question);
  if (categorie) {
    const texte = reponseConversation(categorie, reglages);
    premier();
    yield { type: 'texte', texte };
    durees.total = Date.now() - debut;
    yield { type: 'fin', issue: 0, categorie, texte, renvois: {}, sources: [], documents: [], durees };
    return;
  }

  yield { type: 'etat', etat: 'comprehension' };
  // The previous exchange is joined only when the question cannot stand on its own: a complete
  // question is never read through the one before it.
  const contexte = reglages.memoire && besoinDeContexte(question) ? historique : [];
  const c = await comprendre(cfg, reglages, question, contexte, signal);
  // A rewritten query that shares nothing with the question has drifted: the raw question is used
  if (!reformulationFiable(question, `${c.requete} ${c.question}`)) {
    Object.assign(c, { question, requete: question, terme: '', valide: false, derive: true });
  }
  c.contexte = contexte.length > 0;
  durees.comprehension = Date.now() - debut;
  // A sign of gravity found in the question itself, or by the model: the warning closes the answer
  // Signs of gravity: the warning closes the answer (the gestures are read first). The state of the
  // network is asked for now, in the background: it is read only at the end.
  const urgence = signeDeGravite(question, c.gravite);
  const etatReseau = urgence && reseau
    ? Promise.race([
      Promise.resolve().then(reseau).catch(() => 'inconnu'),
      new Promise((r) => setTimeout(() => r('inconnu'), DELAI_RESEAU))
    ])
    : null;

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
    const ajouter = (t) => { texte += t; return { type: 'texte', texte: t }; };
    const extraits = utiles(r.extraits, reglages, urgence);
    if (issue === 1 && !extraits.length) issue = 2;
    // Emergency: never stop at the warning when a guide has something on the subject
    const guides = r.documents.filter((d) => estGuide(d) && (d.cosinus ?? -1) >= seuil(reglages, d).proches);
    if (urgence && issue === 3 && guides.length) issue = 2;

    if (issue === 1) {
      yield { type: 'etat', etat: 'redaction' };
      let tampon = '';
      let decide = false;
      for await (const t of discuter(cfg, messagesReponse(reglages, extraits, c.question), options)) {
        if (decide) { yield ajouter(t); continue; }
        tampon += t;
        const m = marqueur(tampon);
        if (m === 'peut-etre') continue;
        if (m === 'oui') { issue = 2; break; } // leaving the loop closes the stream: Ollama stops
        decide = true;
        premier();
        yield ajouter(tampon.trimStart());
      }
      if (!decide && issue === 1) {
        if (!tampon.trim()) issue = 2;
        else { premier(); yield ajouter(tampon.trim()); }
      }
    }

    // Closest items: those of a source above its « close » threshold, the best one at least
    let documents = [];
    if (issue === 2) {
      documents = r.documents.filter((d, i) => i === 0 || (d.cosinus ?? -1) >= seuil(reglages, d).proches);
      // Emergency: the guides first, so the answer points to them
      if (urgence && guides.length) documents = [...guides, ...documents.filter((d) => !guides.includes(d))].slice(0, 3);
      if (!documents.length) issue = 3;
    }
    if (issue === 2) {
      // Short text, checked as a whole before it is shown: it must say what the documents are
      // about, never begin to answer
      yield { type: 'etat', etat: 'redaction' };
      let brut = '';
      for await (const t of discuter(cfg, messagesProches(reglages, documents, c.question), options)) brut += t;
      brut = brut.trim();
      if (!brut || !sansInvention(brut, documents, c.question) || ressembleAUneReponse(brut, documents)) {
        brut = repliProches(reglages, documents);
      }
      premier();
      yield ajouter(brut);
    }

    if (issue === 3) {
      const phrases = reglages.jeNeSaisPas;
      premier();
      yield ajouter(remplacer(phrases[Math.floor(Math.random() * phrases.length)], reglages));
    }


    let reseauUtilise = null;
    if (urgence) {
      reseauUtilise = etatReseau ? await etatReseau : 'inconnu';
      yield ajouter(`\n\n${messageUrgence(reglages, reseauUtilise)}`);
    }

    durees.total = Date.now() - debut;
    yield {
      type: 'fin',
      issue,
      comprehension: c,
      urgence,
      reseau: reseauUtilise,
      // texte: the whole answer, with its references renumbered by source
      ...(issue === 1 ? sources(texte, extraits) : { texte, renvois: {}, sources: [] }),
      documents: documents.map((d) => ({ origine: d.origine, etiquette: etiquette(d), titre: d.titre, libelle: titreSource({ ...d, pages: d.page ? [d.page] : [] }), type: d.type, chemin: d.chemin, lien: lien(d) })),
      meilleurs: r.meilleurs,
      meilleurCosinus: r.meilleurCosinus,
      durees,
      ...(reglages.debug ? {
        debug: {
          seuils: reglages.seuils,
          terme: r.terme,
          extraits: r.extraits.map((e) => ({ origine: e.origine, source: e.source, titre: e.titre, chemin: e.chemin, page: e.page, section: e.section, texte: e.texte, cosinus: e.cosinus, rrf: e.rrf, rangVecteur: e.rangVecteur, rangMots: e.rangMots, bm25: e.bm25, bm25Brut: e.bm25Brut, regles: e.regles, envoye: extraits.includes(e) })),
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

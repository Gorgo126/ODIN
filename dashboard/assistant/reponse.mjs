import { discuter } from './generation.mjs';
import { comprendre } from './comprehension.mjs';
import { messagesReponse, remplacer, etiquette, titreSource } from './prompt.mjs';
import { conversation, reponseConversation } from './conversation.mjs';
import { besoinDeContexte, reformulationFiable } from './contexte.mjs';
import { signeDeGravite, messageUrgence, estGuide } from './securite.mjs';
import { lien, cleSource, grouper } from './passages.mjs';
import { preparer, EXTRAITS } from './recherche-avancee.mjs';

export { lienDocument } from './passages.mjs';

// Answer pipeline of the assistant (AI option), built on the advanced search, as a stream of events:
//   { type: 'etat', etat: 'comprehension' | 'recherche' | 'redaction' }
//   { type: 'texte', texte }              pieces of the answer, in order
//   { type: 'fin', issue, texte, resultats, avertissement, ... } the final text replaces the pieces
//   { type: 'erreur', message }
// 0. A conversation (« salut », « merci ») is recognised by fixed rules: short reply, no call at all.
// 1. Understanding: the synonym table, as in the search page. The model only rewrites a follow-up
//    question that cannot stand on its own (« et pour un enfant ? »).
// 2. Search: exactly the advanced search (same queries, same sources, same passages).
// 3. Outcome, decided from the best raw cosine of each source BEFORE any other model call:
//    1 one source ≥ its answer threshold: an answer written from the passages
//    2 one source ≥ its « close » threshold: no writing, the closest passages are shown
//    3 below: a « don't know » sentence from the settings, no model call.
//    4 fallback: the model failed (error, no first word in time, a figure absent from the passages):
//      its text is dropped, the passages are shown with the reason.
// The passages of the search always come with the answer (resultats), whatever the outcome.
// rechercher(question, options) and reprendre(jeton) come from the index.

const SEUILS = { documents: 'documents', wiki: 'wikis', livre: 'livres' };
const seuil = (reglages, e) => reglages.seuils[SEUILS[e.origine] || 'documents'];
const DELAI_PREMIER_MOT = 60000; // no first word after that: the passages are shown instead
const DELAI_EMPLACEMENT = 1500;  // /api/ps, read after the answer: never delays it much

// Could the start of the answer still be the [NON_TROUVE] marker? (with or without brackets)
function marqueur(debut) {
  const n = debut.trimStart().replace(/^\[/, '').toUpperCase();
  if (n.startsWith('NON_TROUV') || n.startsWith('NON TROUV')) return 'oui';
  return n.length < 10 && ('NON_TROUVE'.startsWith(n) || 'NON TROUVE'.startsWith(n)) ? 'peut-etre' : 'non';
}

// Nothing may be invented: a figure of the answer that is neither in the question nor in the
// passages sent (text, titles, sections, pages) makes the answer fall back to the passages.
// References [n] are not figures of the answer.
export function sansInvention(texte, extraits, question) {
  const permis = new Set(`${question} ${extraits.map((e) => `${e.titre || ''} ${e.section || ''} ${e.page || ''} ${e.texte}`).join(' ')}`.match(/\d+/g) || []);
  return (texte.replace(/\[\d+\]/g, ' ').match(/\d+/g) || []).every((n) => permis.has(n));
}

// Where the model runs (Ollama /api/ps): share in video memory, or null when unknown
async function emplacement(cfg) {
  try {
    const ps = await fetch(`${cfg.ollama}/api/ps`, { signal: AbortSignal.timeout(DELAI_EMPLACEMENT) }).then((r) => r.json());
    const p = (ps.models || []).find((m) => m.name === cfg.modeleChat || m.model === cfg.modeleChat);
    return p?.size ? p.size_vram / p.size : null;
  } catch {
    return null;
  }
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
  const premier = () => { durees.premierMot ??= Date.now() - debut; };
  let modeleAppele = false;

  // « salut », « merci » : fixed rules, no call at all (« comment faire du feu ? » is a question)
  const categorie = conversation(question);
  if (categorie) {
    const texte = reponseConversation(categorie, reglages);
    premier();
    yield { type: 'texte', texte };
    durees.total = Date.now() - debut;
    yield { type: 'fin', issue: 0, categorie, texte, renvois: {}, sources: [], resultats: null, durees };
    return;
  }

  // A follow-up question is rewritten by the model into a standalone one; any other question is
  // read by the synonym table only. A rewrite that drifts from the question is dropped.
  let autonome = question;
  let c = null;
  if (reglages.memoire && historique.length && besoinDeContexte(question)) {
    yield { type: 'etat', etat: 'comprehension' };
    modeleAppele = true;
    c = await comprendre(cfg, reglages, question, historique, signal);
    if (c.valide && reformulationFiable(question, `${c.requete} ${c.question}`)) autonome = c.question;
    durees.comprehension = Date.now() - debut;
  }
  const p = preparer(autonome);
  // Signs of gravity: the warning closes the answer (the gestures are read first). The state of the
  // network is asked for now, in the background: it is read only at the end.
  const urgence = signeDeGravite(question, c?.gravite);
  const etatReseau = urgence && reseau
    ? Promise.race([
      Promise.resolve().then(reseau).catch(() => 'inconnu'),
      new Promise((r) => setTimeout(() => r('inconnu'), DELAI_RESEAU))
    ])
    : null;

  yield { type: 'etat', etat: 'recherche' };
  let r;
  try {
    r = await rechercher(autonome, {
      n: EXTRAITS, garder: true, sources: parmi,
      requetes: p.requetes, terme: p.terme, termeSur: p.termeSur, secondaires: p.secondaires, texteVecteur: p.texteVecteur
    });
  } catch (e) {
    yield { type: 'erreur', message: `Recherche impossible : ${e.message}` };
    return;
  }
  durees.recherche = Date.now() - debut;
  durees.sources = r.durees;

  try {
    // The passages of the advanced search, shown under every answer
    const resultats = grouper(r, autonome, reglages, { urgence, termes: p.comprehension.cherche });
    // At most reglages.extraits passages reach the model (reading time on the card, and focus); in an
    // emergency the medical guide keeps its place among them
    const retenus = r.vecteurs ? utiles(r.extraits, reglages, urgence) : [];
    const extraits = retenus.slice(0, reglages.extraits);
    const guide = urgence && retenus.find((e) => estGuide(e));
    if (guide && !extraits.includes(guide)) extraits.splice(extraits.length - 1, 1, guide);
    const niveaux = Object.entries(r.meilleurs).filter(([, m]) => m != null);
    let issue = !r.vecteurs ? (resultats.forts.length || resultats.proches.length ? 2 : 3)
      : niveaux.some(([s, m]) => m >= reglages.seuils[s].reponse) && extraits.length ? 1
        : resultats.forts.length || resultats.proches.length ? 2 : 3;
    // Emergency: never stop at « don't know » when a medical guide has something on the subject
    const guides = [...resultats.forts, ...resultats.proches].filter((g) => g.guide);
    if (urgence && issue === 3 && guides.length) issue = 2;

    let texte = '';
    let repli = null;
    if (issue === 1) {
      yield { type: 'etat', etat: 'redaction' };
      modeleAppele = true;
      // No first word in time: the call is stopped and the passages are shown instead
      const arret = new AbortController();
      const delai = cfg.delaiPremierMot || DELAI_PREMIER_MOT;
      const lent = setTimeout(() => arret.abort('lent'), delai);
      const options = { temperature: reglages.temperature, signal: signal ? AbortSignal.any([signal, arret.signal]) : arret.signal };
      let tampon = '';
      let decide = false;
      try {
        for await (const t of discuter(cfg, messagesReponse(reglages, extraits, autonome), options)) {
          clearTimeout(lent);
          if (decide) { texte += t; yield { type: 'texte', texte: t }; continue; }
          tampon += t;
          const m = marqueur(tampon);
          if (m === 'peut-etre') continue;
          if (m === 'oui') { issue = 2; break; } // leaving the loop closes the stream: Ollama stops
          decide = true;
          premier();
          texte = tampon.trimStart();
          yield { type: 'texte', texte };
        }
        if (!decide && issue === 1) {
          if (tampon.trim()) { premier(); texte = tampon.trim(); yield { type: 'texte', texte }; } else issue = 2;
        }
        if (issue === 1 && !sansInvention(texte, extraits, autonome)) {
          repli = 'La réponse citait un chiffre absent des passages : elle a été écartée.';
        }
      } catch (e) {
        if (signal?.aborted) return;
        repli = arret.signal.reason === 'lent'
          ? `Le modèle n'a pas commencé à répondre en ${Math.round(delai / 1000)} s.`
          : `Le modèle n'a pas pu répondre (${e.message}).`;
      } finally {
        clearTimeout(lent);
      }
      if (repli) issue = 4;
    }

    const tu = reglages.personnalite.tutoiement;
    if (issue === 2) texte = r.vecteurs
      ? `Je n'ai pas trouvé de réponse précise. ${tu ? 'Voici les passages les plus proches : tu y trouveras peut-être de quoi avancer.' : 'Voici les passages les plus proches : vous y trouverez peut-être de quoi avancer.'}`
      : 'Le service de vecteurs ne répond pas : voici les passages trouvés par mots-clés.';
    if (issue === 3) texte = remplacer(reglages.jeNeSaisPas[Math.floor(Math.random() * reglages.jeNeSaisPas.length)], reglages);
    if (issue === 4) texte = `${repli} Voici les passages trouvés.`;
    if (issue !== 1) { premier(); yield { type: 'texte', texte }; }

    let reseauUtilise = null;
    if (urgence) {
      reseauUtilise = etatReseau ? await etatReseau : 'inconnu';
      const avert = `\n\n${messageUrgence(reglages, reseauUtilise)}`;
      texte += avert;
      yield { type: 'texte', texte: avert };
    }

    // The model partly or wholly on the CPU: slow answers, said once under the answer
    let avertissement = null;
    if (modeleAppele && cfg.ollama) {
      const gpu = await emplacement(cfg);
      if (gpu != null && gpu < 0.99) {
        avertissement = gpu <= 0.01
          ? 'Le modèle tourne sur le processeur, pas sur la carte graphique : les réponses sont lentes.'
          : `Le modèle ne tient pas entièrement dans la carte graphique (${Math.round(gpu * 100)} % dessus) : les réponses sont lentes.`;
      }
    }

    durees.total = Date.now() - debut;
    yield {
      type: 'fin',
      issue,
      comprehension: { table: p.comprehension.entrees, reformulee: autonome !== question ? autonome : null },
      urgence,
      reseau: reseauUtilise,
      repli,
      avertissement,
      // texte: the whole answer, with its references renumbered by source
      ...(issue === 1 ? sources(texte, extraits) : { texte, renvois: {}, sources: [] }),
      resultats,
      meilleurs: r.meilleurs,
      meilleurCosinus: r.meilleurCosinus,
      durees,
      ...(reglages.debug ? {
        debug: {
          seuils: reglages.seuils,
          terme: r.terme,
          requetes: p.requetes,
          extraits: r.extraits.map((e) => ({ origine: e.origine, source: e.source, titre: e.titre, chemin: e.chemin, page: e.page, section: e.section, texte: e.texte, cosinus: e.cosinus, rrf: e.rrf, rangVecteur: e.rangVecteur, rangMots: e.rangMots, bm25: e.bm25, bm25Brut: e.bm25Brut, regles: e.regles, envoye: extraits.includes(e) }))
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

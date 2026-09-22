import { discuter, completer } from './generation.mjs';
import { messagesReponse, messagesProches, messagesReformulation, remplacer } from './prompt.mjs';

// Answer pipeline of the document assistant, as a stream of events:
//   { type: 'etat', etat: 'reformulation' | 'recherche' | 'redaction' }
//   { type: 'texte', texte }              pieces of the answer, in order
//   { type: 'fin', issue: 1 | 2 | 3, ... } sources, documents, timings, debug
//   { type: 'erreur', message }
// The outcome is decided from the best raw cosine BEFORE any call to the language model:
//   1 ≥ seuilReponse: answer written from the chunks (the model may still say [NON_TROUVE] → 2)
//   2 ≥ seuilProches: 1 to 3 sentences on the closest documents, never an answer
//   3 below: a « don't know » sentence from the settings, no model call.
// rechercher(question, { n, garder }) and reprendre(jeton) come from the index (worker or direct).

// Where a source opens: PDFs in the viewer at the right page, other files as they are
export function lienDocument(chemin, page) {
  if (/\.pdf$/i.test(chemin)) return `/assistant/document?chemin=${encodeURIComponent(chemin)}${page ? `&page=${page}` : ''}`;
  return `/fichiers-documents/${chemin.split('/').map(encodeURIComponent).join('/')}`;
}

// Could the start of the answer still be the [NON_TROUVE] marker? (with or without brackets)
function marqueur(debut) {
  const n = debut.trimStart().replace(/^\[/, '').toUpperCase();
  if (n.startsWith('NON_TROUV') || n.startsWith('NON TROUV')) return 'oui';
  return n.length < 10 && ('NON_TROUVE'.startsWith(n) || 'NON TROUVE'.startsWith(n)) ? 'peut-etre' : 'non';
}

// Outcome 2 must never answer: a number that is neither in the question nor in the titles and
// summaries was invented. The text is then replaced by a plain sentence listing the documents.
function sansInvention(texte, documents, question) {
  const permis = new Set(`${question} ${documents.map((d) => `${d.titre} ${d.resume || ''}`).join(' ')}`.match(/\d+/g) || []);
  return (texte.match(/\d+/g) || []).every((n) => permis.has(n)) && !/\[/.test(texte);
}

function repliProches(reglages, documents) {
  const tu = reglages.personnalite.tutoiement;
  const noms = documents.map((d) => `« ${d.titre} »`);
  const liste = noms.length > 1 ? `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}` : noms[0];
  const cherche = tu ? 'Tu y trouveras peut-être de quoi avancer.' : 'Vous y trouverez peut-être de quoi avancer.';
  return `Je n'ai pas trouvé de réponse exacte, mais ${noms.length > 1 ? 'ces documents s\'en rapprochent' : 'ce document s\'en rapproche'} : ${liste}. ${cherche}`;
}

function sources(texte, extraits) {
  const cites = [...new Set([...texte.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))].filter((n) => n >= 1 && n <= extraits.length);
  const renvois = Object.fromEntries(cites.map((n) => {
    const e = extraits[n - 1];
    return [n, { titre: e.titre, chemin: e.chemin, page: e.page, lien: lienDocument(e.chemin, e.page) }];
  }));
  // Documents in the order they are cited; all those of the chunks if the model cited none
  const liste = new Map();
  for (const e of cites.length ? cites.map((n) => extraits[n - 1]) : extraits) {
    const s = liste.get(e.chemin) || { titre: e.titre, chemin: e.chemin, type: e.type, pages: [], lien: lienDocument(e.chemin, e.page) };
    if (e.page && !s.pages.includes(e.page)) s.pages.push(e.page);
    liste.set(e.chemin, s);
  }
  return { renvois, sources: [...liste.values()] };
}

export async function* repondre({ question, historique = [], reglages, cfg, rechercher, reprendre, signal }) {
  const debut = Date.now();
  const durees = {};
  const options = { temperature: reglages.temperature, signal };
  let autonome = question;

  if (reglages.memoire && historique.length) {
    yield { type: 'etat', etat: 'reformulation' };
    try {
      const r = await completer(cfg, messagesReformulation(historique.slice(-1), question), { temperature: 0, signal });
      const ligne = r.split('\n')[0].replace(/^["«\s]+|["»\s]+$/g, '').slice(0, 300);
      if (ligne.length > 3) autonome = ligne;
    } catch (e) {
      if (signal?.aborted) throw e;
      // Rewriting failed: the question is searched as it was asked
    }
    durees.reformulation = Date.now() - debut;
  }

  yield { type: 'etat', etat: 'recherche' };
  let r;
  try {
    r = await rechercher(autonome, { n: reglages.extraits, garder: true });
  } catch (e) {
    yield { type: 'erreur', message: `Recherche impossible : ${e.message}` };
    return;
  }
  durees.recherche = Date.now() - debut;

  try {
    if (!r.vecteurs) {
      yield { type: 'erreur', message: 'Le moteur d\'IA ne répond pas pour le moment : réessaie dans un instant.' };
      return;
    }
    const cos = r.meilleurCosinus ?? 0;
    let issue = cos >= reglages.seuilReponse ? 1 : cos >= reglages.seuilProches ? 2 : 3;
    let texte = '';
    const premier = () => { durees.premierMot ??= Date.now() - debut; };

    if (issue === 1) {
      yield { type: 'etat', etat: 'redaction' };
      let tampon = '';
      let decide = false;
      for await (const t of discuter(cfg, messagesReponse(reglages, r.extraits, autonome), options)) {
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

    // Closest documents: those not far below the threshold, the best one at least
    let documents = [];
    if (issue === 2) {
      documents = r.documents.filter((d, i) => i === 0 || (d.cosinus ?? 0) >= reglages.seuilProches);
      if (!documents.length) issue = 3;
    }
    if (issue === 2) {
      // Short text (1 to 3 sentences), checked as a whole before it is shown
      yield { type: 'etat', etat: 'redaction' };
      for await (const t of discuter(cfg, messagesProches(reglages, documents, autonome), options)) texte += t;
      texte = texte.trim();
      if (!texte || !sansInvention(texte, documents, autonome)) texte = repliProches(reglages, documents);
      premier();
      yield { type: 'texte', texte };
    }

    if (issue === 3) {
      const phrases = reglages.jeNeSaisPas;
      texte = remplacer(phrases[Math.floor(Math.random() * phrases.length)], reglages);
      premier();
      yield { type: 'texte', texte };
    }

    durees.total = Date.now() - debut;
    yield {
      type: 'fin',
      issue,
      ...(autonome !== question ? { questionAutonome: autonome } : {}),
      ...(issue === 1 ? sources(texte, r.extraits) : { renvois: {}, sources: [] }),
      documents: documents.map((d) => ({ titre: d.titre, type: d.type, chemin: d.chemin, lien: lienDocument(d.chemin, d.page) })),
      meilleurCosinus: r.meilleurCosinus,
      durees,
      ...(reglages.debug ? {
        debug: {
          seuils: { reponse: reglages.seuilReponse, proches: reglages.seuilProches },
          extraits: r.extraits.map((e) => ({ titre: e.titre, chemin: e.chemin, page: e.page, section: e.section, texte: e.texte, cosinus: e.cosinus, rrf: e.rrf, rangVecteur: e.rangVecteur, rangMots: e.rangMots })),
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

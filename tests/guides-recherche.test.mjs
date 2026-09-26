// « Comment faire ? » source of the advanced search, on a small installed index in a temporary folder
// (GUIDES_DOSSIER, set before any import). node --test tests/guides-recherche.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';

const d = mkdtempSync(`${tmpdir()}/guides-`);
mkdirSync(`${d}/v1`);
symlinkSync('v1', `${d}/actuel`);
const art = (slug, keywords, textes) => ({ slug, title: slug, category: 'c', keywords, sections: textes.map((t, i) => ({ titre: `S${i}`, texte: `${t} ${'x'.repeat(70)}` })) });
writeFileSync(`${d}/v1/guides.json`, JSON.stringify({ articles: [
  art('orientation', ['je suis perdu'], ['La carte.', 'La boussole.', 'Le soleil.', 'Les étoiles.', 'Le terrain.', 'Quand on est perdu.']),
  art('secours', ['brûlure'], ['Une brûlure se refroidit sous l eau.']),
  art('energie', ['coupure de courant', "plus d'électricité"], ['Des lampes frontales et une batterie.', 'Le solaire.', 'Le groupe électrogène.']),
  art('premiers-secours', ['appeler le 112', 'brûlure'], ['Les gestes qui sauvent.', 'Masser le cœur.']),
  // Distractors: the words of the questions in their text, many times, without the keywords
  art('communiquer', [], ['Une coupure du réseau, le courant coupé, la coupure de la box, le courant revenu.', 'Appeler, appeler encore.']),
  art('urgences', [], ['Pour appeler les secours, appeler vite, appeler clairement.'])
] }));
process.env.GUIDES_DOSSIER = d;
const { passagesGuides, motsClesExacts, correspondance, analyserMotsCles } = await import('../dashboard/assistant/source-guides.mjs');
const titres = async (requetes) => (await passagesGuides(requetes)).map((p) => p.titre);

test('keywords : les petits mots et verbes courants ne font rien remonter', async () => {
  const t = await titres(['je me suis brûlé', 'brûlure', 'suis']);
  assert.equal(t[0], 'secours');
  assert.ok(!t.includes('orientation'));
});

test('keywords : un article trouvé par ses seuls keywords', async () => {
  assert.equal((await titres(["plus d'électricité"]))[0], 'energie');
  assert.equal((await titres(['coupure de courant']))[0], 'energie');
});

test('mot-clé entier dans la question : l\'article vient en tête de sa source, nombres compris', async () => {
  const p112 = await passagesGuides(['appeler le 112', 'appeler']);
  assert.equal(p112[0].titre, 'premiers-secours');
  assert.equal(p112[0].motCle?.niveau, 'complet');
  const courant = await passagesGuides(['coupure de courant', 'panne de courant', 'électricité', 'coupure']);
  assert.equal(courant[0].titre, 'energie');
  assert.ok(!courant.some((p) => p.titre !== 'energie' && p.motCle));
  // A keyword found only inside a longer word or sentence does not count: « 112 » alone is not « appeler le 112 »
  assert.ok(!(await passagesGuides(['le 112'])).some((p) => p.motCle));
});

test('mot-clé entier : complet ou modéré selon ce qu\'il couvre de la question', () => {
  const niveau = (q, cles) => correspondance(q, analyserMotsCles(cles))?.niveau || null;
  // Complete: several meaningful words, or most of the question
  assert.equal(niveau('coupure de courant', ['coupure de courant']), 'complet');
  assert.equal(niveau('appeler le 112', ['appeler le 112']), 'complet');
  assert.equal(niveau("plus d'électricité", ["plus d'électricité"]), 'complet');
  assert.equal(niveau('je suis perdu', ['je suis perdu']), 'complet');
  // Moderate: one generic word inside a longer question
  assert.equal(niveau('coup de soleil', ['soleil']), 'modere');
  assert.equal(niveau('radio du thorax', ['radio']), 'modere');
  assert.equal(niveau('batterie de voiture à plat', ['batterie']), 'modere');
  assert.equal(niveau('savon pour bébé', ['savon']), 'modere');
  assert.equal(niveau('ma montre ne marche plus', ['montre en panne']), null);
});

test('après les vecteurs : complet en tête et en « fort », modéré sans forcer « fort », un seul gagnant', () => {
  const p = (titre, cosinus, motCle) => ({ origine: 'comment-faire', titre, cosinus, ajustement: 0, ...(motCle ? { motCle } : {}) });
  const note = (x) => x.cosinus + (x.ajustement || 0);
  const complet = (plancher = 0.25) => ({ niveau: 'complet', cle: 'coupure de courant', plancher });
  const modere = { niveau: 'modere', cle: 'soleil', plancher: 0.35 };
  // Complete: first and « fort »; the others untouched; the wiki passages untouched
  const a = [p('Rester joignable', 0.39), p('Autonomie', 0.359, complet()), p('Abri', 0.351), { origine: 'wiki', titre: 'W', cosinus: 0.7 }];
  motsClesExacts(a, 0.46);
  assert.ok(note(a[1]) >= 0.46 && note(a[1]) > note(a[0]));
  assert.equal(a[0].ajustement, 0);
  assert.equal(a[3].ajustement, undefined);
  // Moderate: helps, never « fort » through the bonus, nothing under its floor
  const b = [p('Orientation', 0.44, modere), p('Hygiène', 0.28, { ...modere, cle: 'savon' }), p('Autre', 0.40)];
  motsClesExacts(b, 0.46);
  assert.ok(note(b[0]) > 0.44 && note(b[0]) < 0.46);
  assert.equal(b[1].ajustement, 0);
  // Several articles sharing a complete keyword: only the best cosine is forced, the other is moderate
  const c = [p('Autonomie', 0.36, complet(0.35)), p('Rester joignable', 0.37, complet(0.35))];
  motsClesExacts(c, 0.46);
  assert.ok(note(c[1]) >= 0.46);
  assert.ok(note(c[0]) < 0.46 && note(c[0]) > 0.36);
  // A complete match that the embedding contradicts (under its floor): nothing changes
  const d = [p('Autonomie', 0.2, complet()), p('Autre', 0.4)];
  motsClesExacts(d, 0.46);
  assert.equal(d[0].ajustement, 0);
});

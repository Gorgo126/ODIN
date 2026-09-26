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
const { passagesGuides, motsClesExacts } = await import('../dashboard/assistant/source-guides.mjs');
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
  assert.equal(p112[0].motCleExact, true);
  const courant = await passagesGuides(['coupure de courant', 'panne de courant', 'électricité', 'coupure']);
  assert.equal(courant[0].titre, 'energie');
  assert.ok(!courant.some((p) => p.titre !== 'energie' && p.motCleExact));
  // A keyword found only inside a longer word or sentence does not count: « 112 » alone is not « appeler le 112 »
  assert.ok(!(await passagesGuides(['le 112'])).some((p) => p.motCleExact));
});

test('mot-clé entier : en tête et en « fort » après les vecteurs, sauf contradiction nette', () => {
  const p = (titre, cosinus, motCleExact) => ({ origine: 'comment-faire', titre, cosinus, ajustement: 0, ...(motCleExact ? { motCleExact } : {}) });
  const passages = [p('Rester joignable', 0.39), p('Autonomie', 0.359, true), p('Abri', 0.351), { origine: 'wiki', titre: 'W', cosinus: 0.7 }];
  motsClesExacts(passages, 0.46);
  const note = (x) => x.cosinus + (x.ajustement || 0);
  assert.ok(note(passages[1]) >= 0.46);
  assert.ok(note(passages[1]) > note(passages[0]));
  assert.equal(passages[0].ajustement, 0);
  assert.equal(passages[3].ajustement, undefined);
  // Cosine below the floor: the embedding clearly disagrees, nothing is changed
  const contredit = [p('Autonomie', 0.2, true), p('Autre', 0.4)];
  motsClesExacts(contredit, 0.46);
  assert.equal(contredit[0].ajustement, 0);
});

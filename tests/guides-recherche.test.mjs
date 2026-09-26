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
  art('energie', ['coupure de courant', "plus d'électricité"], ['Des lampes frontales et une batterie.'])
] }));
process.env.GUIDES_DOSSIER = d;
const { passagesGuides } = await import('../dashboard/assistant/source-guides.mjs');
const titres = async (requetes) => (await passagesGuides(requetes)).map((p) => p.titre);

test('keywords : les petits mots et verbes courants ne font rien remonter', async () => {
  const t = await titres(['je me suis brûlé', 'brûlure', 'suis']);
  assert.equal(t[0], 'secours');
  assert.ok(!t.includes('orientation'));
});

test('keywords : un article trouvé par ses seuls keywords', async () => {
  assert.deepEqual([...new Set(await titres(["plus d'électricité"]))], ['energie']);
  assert.deepEqual([...new Set(await titres(['coupure de courant']))], ['energie']);
});

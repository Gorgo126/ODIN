// Tests of the synonym table rule: an expression that keeps one meaningful word once its small words
// are removed must be found as written. node --test tests/synonymes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiler, comprendre } from '../dashboard/assistant/synonymes.mjs';

const table = compiler({
  entrees: [
    { dit: ['la courante', 'diarrhée'], cherche: ['diarrhée'] },
    { dit: ['coupure de courant'], cherche: ['panne de courant'] },
    { dit: ['coupure au doigt', 'je me suis coupé'], cherche: ['plaie'] },
    { dit: ["j'ai froid", 'a froid'], cherche: ['hypothermie'] }
  ]
});
const terme = (q) => comprendre(q, table).terme;

test('expression d\'une seule racine : trouvée telle qu\'écrite', () => {
  assert.equal(terme("j'ai la courante"), 'diarrhée');
  assert.equal(terme('panne de courant'), null);
  assert.equal(terme('le courant de la rivière'), null);
  assert.equal(terme('il a froid'), 'hypothermie');
  assert.equal(terme('eau froide'), null);
});

test('coupure : seulement dans des expressions précises', () => {
  assert.equal(terme('coupure de courant'), 'panne de courant');
  assert.equal(terme("coupure d'eau"), null);
  assert.equal(terme('une coupure au doigt'), 'plaie');
  assert.equal(terme('je me suis coupé'), 'plaie');
});

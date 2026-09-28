// Tests of the per-pack quota of the wiki source (dashboard/assistant/quota.mjs):
// node --test tests/quota.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repartir } from '../dashboard/assistant/quota.mjs';

// e('A', 10) : pack A, score 10, one article per element unless given
let n = 0;
const e = (pack, score, article = `${pack}${n++}`) => ({ pack, score, article });
const packs = (l) => l.map((x) => x.pack).join('');

test('sans pack en excès : les n premiers, comme sans quota', () => {
  const l = [e('A', 10), e('B', 9), e('A', 8), e('B', 7), e('A', 1)];
  assert.deepEqual(repartir(l, 4, { parPack: 2 }), l.slice(0, 4));
});

test('pack dominant sans concurrent (autres packs sous 50 % du meilleur) : il garde ses places', () => {
  const l = [e('M', 10), e('M', 9), e('M', 8), e('M', 7), e('N', 4.9), e('N', 4)];
  assert.equal(packs(repartir(l, 4, { parPack: 2 })), 'MMMM');
});

test('concurrent à 50 % ou plus : le pack dominant est plafonné, les places vont aux concurrents seulement', () => {
  const l = [e('M', 10), e('M', 9), e('M', 8), e('M', 7), e('N', 5), e('N', 2), e('N', 1)];
  // one competing element (5 ≥ 50 % of 10): one place given back, weak N elements never taken
  assert.equal(packs(repartir(l, 4, { parPack: 2 })), 'MMMN');
});

test('assez de concurrents : le pack dominant descend à son plafond', () => {
  const l = [e('M', 10), e('M', 9), e('M', 8), e('M', 7), e('N', 6), e('N', 5.5), e('C', 5)];
  const r = repartir(l, 4, { parPack: 2 });
  assert.equal(packs(r), 'MMNN');
  // the pack keeps its best elements, gives up its last ones
  assert.deepEqual(r.slice(0, 2), l.slice(0, 2));
});

test('au plus parArticle éléments par article, les autres reviennent s\'il ne reste rien', () => {
  const l = [e('M', 10, 'x'), e('M', 9, 'x'), e('M', 8, 'x'), e('M', 7, 'y')];
  assert.deepEqual(repartir(l, 3, { parPack: 10, parArticle: 2 }).map((x) => x.score), [10, 9, 7]);
  assert.equal(repartir(l, 4, { parPack: 10, parArticle: 2 }).length, 4);
});

test('les éléments fixes (titre exact) ne sont jamais rendus', () => {
  const l = [e('M', 1), e('M', 10), e('M', 9), e('N', 8), e('N', 7)];
  const r = repartir(l, 3, { parPack: 1, fixes: 1 });
  assert.equal(r[0], l[0]);
  assert.equal(packs(r), 'MNN');
});

test('liste vide ou scores nuls : rien ne casse', () => {
  assert.deepEqual(repartir([], 8, { parPack: 4 }), []);
  const l = [e('A', 0), e('A', 0), e('B', 0)];
  assert.deepEqual(repartir(l, 2, { parPack: 1 }), l.slice(0, 2));
});

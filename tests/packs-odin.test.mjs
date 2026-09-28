// Tests of the catalogue entries of the packs built by ODIN (catalogue/packs-odin.json):
// node --test tests/packs-odin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { entreeOdin, entreeFiche } from '../dashboard/lib/catalogue.mjs';

const bonne = {
  id: 'nopanic', nom: 'nopanic_fr_articles', variante: 'maxi', libelle: 'Articles de NoPanic',
  url: 'https://github.com/Gorgo126/ODIN/releases/download/nopanic-2026-09-28-1/nopanic_fr_articles_maxi_2026-09-28.zim',
  sha256: 'a'.repeat(64), taille: 472758027, date: '2026-09-28', uuid: 'u', articles: 569, medias: 3273
};

test('entrée complète acceptée, au format du catalogue Kiwix avec son empreinte', () => {
  assert.equal(entreeOdin(bonne), true);
  const e = entreeFiche(bonne);
  assert.equal(e.url, bonne.url);
  assert.equal(e.taille, bonne.taille);
  assert.equal(e.sha256, bonne.sha256);
  assert.equal(e.variante, 'maxi');
});

test('entrées incomplètes ou incohérentes refusées', () => {
  const mauvaises = [
    null, {}, { ...bonne, url: undefined }, { ...bonne, url: 'http://exemple/nopanic_fr_articles_maxi_x.zim' },
    { ...bonne, sha256: 'abc' }, { ...bonne, taille: 0 }, { ...bonne, taille: '12' },
    // the file must carry <nom>_<variante>_ (ODIN finds the files of a pack by this prefix)
    { ...bonne, url: 'https://github.com/x/releases/download/t/autre_maxi_2026.zim' },
    { ...bonne, variante: 'nopic' }, { ...bonne, id: '../x' }, { ...bonne, url: 'https://x/%E0%A4%A.zim' }
  ];
  const erreur = console.error;
  console.error = () => {};
  try {
    for (const m of mauvaises) assert.equal(entreeOdin(m), false, JSON.stringify(m));
  } finally {
    console.error = erreur;
  }
});

test('catalogue/packs-odin.json du dépôt : chaque entrée est valide', () => {
  let cat;
  try { cat = JSON.parse(readFileSync(new URL('../catalogue/packs-odin.json', import.meta.url), 'utf8')); } catch { return; }
  for (const p of cat.packs) assert.equal(entreeOdin(p), true, p.id);
});

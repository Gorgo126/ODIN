// Tests of the « Comment faire ? » articles: HTML cleaning, archive reading and checks, manifest,
// differences. No dependency: node --test tests/guides.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'zlib';
import { nettoyer } from '../dashboard/lib/guides-html.mjs';
import { lireTarGz } from '../dashboard/lib/tar.mjs';
import { validerArchive, defautManifeste, comparer, motsCles, construireIndex } from '../dashboard/lib/guides.mjs';

const ctx = {
  slug: 'eau',
  articles: new Map([['eau', 'eau'], ['feu', 'feu']]),
  assets: new Set(['eau/schema-1.svg', 'feu/schema-1.svg'])
};

test('nettoyage : balises, attributs et contenus dangereux retirés', () => {
  const { html } = nettoyer('<p onclick="x()" style="color:red" class="a">Texte <script>alert(1)</script><b>gras</b></p>'
    + '<style>p{}</style><iframe src="https://x"></iframe><div><strong>ok</strong></div><svg><text>t</text></svg>', ctx);
  assert.equal(html, '<p>Texte gras</p><strong>ok</strong>');
});

test('nettoyage : liens javascript:, data: et masqués refusés', () => {
  for (const h of ['javascript:alert(1)', 'JavaScript:alert(1)', 'java\tscript:alert(1)', ' javascript:x', 'data:text/html,x', 'vbscript:x', '&#106;avascript:x']) {
    const { html } = nettoyer(`<a href="${h}">lien</a>`, ctx);
    assert.equal(html, '<a>lien</a>', h);
  }
});

test('nettoyage : lien du blog vers l\'article local, autres liens marqués externes', () => {
  assert.equal(nettoyer('<a href="https://odin-node.com/blog/feu/">x</a>', ctx).html, '<a href="/comment-faire/feu/feu">x</a>');
  assert.equal(nettoyer('<a href="https://odin-node.com/blog/feu#etape">x</a>', ctx).html, '<a href="/comment-faire/feu/feu#etape">x</a>');
  assert.equal(nettoyer('<a href="#section">x</a>', ctx).html, '<a href="#section">x</a>');
  // Blog article not installed: external
  assert.equal(nettoyer('<a href="https://odin-node.com/blog/inconnu">x</a>', ctx).html,
    '<a href="https://odin-node.com/blog/inconnu" target="_blank" rel="noopener noreferrer" data-externe="1">x</a>');
  assert.match(nettoyer('<a href="https://www.service-public.fr/">x</a>', ctx).html, /data-externe="1"/);
});

test('nettoyage : images seulement parmi les assets de l\'article', () => {
  const ok = nettoyer('<figure><img src="assets/eau/schema-1.svg" alt="Schéma" width="600" height="360" onerror="x()"><figcaption>Légende</figcaption></figure>', ctx);
  assert.equal(ok.html, '<figure><img src="/api/guides/assets/eau/schema-1.svg" alt="Schéma" width="600" height="360"><figcaption>Légende</figcaption></figure>');
  for (const src of ['assets/feu/schema-1.svg', 'assets/eau/absent.svg', 'assets/eau/../../x.svg', 'https://exemple.org/a.svg', '/etc/passwd']) {
    assert.equal(nettoyer(`<p><img src="${src}" alt="x"></p>`, ctx).html, '<p></p>', src);
  }
});

test('nettoyage : balises refermées, texte par section', () => {
  const r = nettoyer('<p>Intro <em>un<h2>Premier</h2><p>Texte A</p><h2>Second</h2><ul><li>B</li></ul></p>', ctx);
  assert.equal(r.html, '<p>Intro <em>un</em></p><h2>Premier</h2><p>Texte A</p><h2>Second</h2><ul><li>B</li></ul>');
  assert.deepEqual(r.sections.map((s) => s.titre), ['', 'Premier', 'Second']);
  assert.equal(r.sections[2].texte, 'B');
});

// ustar archive written in memory
function tar(entrees) {
  const blocs = [];
  for (const { nom, contenu = '', type = '0', lien = '' } of entrees) {
    const donnees = Buffer.from(contenu);
    const h = Buffer.alloc(512);
    h.write(nom, 0);
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(`${donnees.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write(type, 156);
    h.write(lien, 157);
    h.write('ustar\u000000', 257);
    let somme = 0;
    for (const o of h) somme += o;
    h.write(`${somme.toString(8).padStart(6, '0')}\0 `, 148);
    blocs.push(h, donnees, Buffer.alloc((512 - (donnees.length % 512)) % 512));
  }
  blocs.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocs));
}

const H = 'a'.repeat(64);
const interne = {
  format: 1, version: 'v1', generated_at: '2026-09-26T00:00:00.000Z',
  categories: [{ slug: 'eau', title: 'Eau', description: 'd', order: 1 }],
  articles: [{ slug: 'boire', title: 'Boire', category: 'eau', summary: 's', published: '2026-09-25', updated: '2026-09-25', sha256: H }]
};
const publie = { ...interne, archive: { url: 'https://odin-node.com/odin/guides/guides-v1.tar.gz', sha256: H, size: 10 } };
const bon = [
  { nom: 'manifest.json', contenu: JSON.stringify(interne) },
  { nom: 'articles/boire.html', contenu: '<p>x</p><img src="assets/boire/s.svg" alt="a">' },
  { nom: 'assets/boire/s.svg', contenu: '<svg/>' }
];

test('archive conforme acceptée', () => {
  const r = validerArchive(lireTarGz(tar(bon)), publie);
  assert.equal(r.articles.size, 1);
  assert.equal(r.assets.size, 1);
});

test('archive refusée : traversée, lien, fichier en trop ou manquant, manifeste différent', () => {
  const cas = {
    traversee: [...bon, { nom: 'assets/boire/../../x.svg', contenu: 'x' }],
    absolu: [...bon, { nom: '/etc/x', contenu: 'x' }],
    enTrop: [...bon, { nom: 'articles/autre.html', contenu: 'x' }],
    racine: [...bon, { nom: 'lisez-moi.txt', contenu: 'x' }],
    manquant: bon.filter((e) => e.nom !== 'articles/boire.html'),
    imageAbsente: bon.filter((e) => !e.nom.startsWith('assets/')),
    manifeste: [{ nom: 'manifest.json', contenu: JSON.stringify({ ...interne, version: 'v2' }) }, ...bon.slice(1)],
    avecArchive: [{ nom: 'manifest.json', contenu: JSON.stringify(publie) }, ...bon.slice(1)],
    double: [...bon, bon[1]]
  };
  for (const [nom, entrees] of Object.entries(cas)) assert.throws(() => validerArchive(lireTarGz(tar(entrees)), publie), Error, nom);
  // Symbolic link: refused as soon as the archive is read
  assert.throws(() => lireTarGz(tar([...bon, { nom: 'assets/boire/l.svg', type: '2', lien: '/etc/passwd' }])), /non prise en charge/);
});

test('manifeste : format différent de 1 refusé, archive hors du site refusée', () => {
  assert.equal(defautManifeste(publie), null);
  assert.match(defautManifeste({ ...publie, format: 2 }), /format 2 non pris en charge/);
  assert.match(defautManifeste({ ...publie, archive: { ...publie.archive, url: 'https://ailleurs.org/a.tar.gz' } }), /hors du site/);
  assert.match(defautManifeste({ ...publie, articles: [{ ...interne.articles[0], slug: '../x' }] }), /article invalide/);
});

test('différences : nouveaux, modifiés, supprimés, par le sha256 seul', () => {
  const local = { articles: [{ slug: 'a', title: 'A', sha256: '1' }, { slug: 'b', title: 'B', sha256: '2' }] };
  const distant = { articles: [{ slug: 'a', title: 'A modifié', sha256: '1' }, { slug: 'b', title: 'B', sha256: '3' }, { slug: 'c', title: 'C', sha256: '4' }] };
  const d = comparer(local, distant);
  assert.deepEqual(d.nouveaux.map((x) => x.slug), ['c']);
  assert.deepEqual(d.modifies.map((x) => x.slug), ['b']);
  assert.deepEqual(comparer(distant, local).supprimes.map((x) => x.slug), ['c']);
  assert.equal(comparer(local, local).aJour, true);
});

test('keywords : facultatif, nettoyé, jamais une raison de refuser', () => {
  assert.deepEqual(motsCles({ slug: 'a' }), []);
  assert.deepEqual(motsCles({ slug: 'a', keywords: [' coupure de courant ', 'électricité', 'électricité', '', 3] }), ['coupure de courant', 'électricité']);
  assert.deepEqual(motsCles({ slug: 'a', keywords: 'panne' }), []);
  // A manifest with keywords stays format 1, and its archive is accepted the same way
  const avec = { ...publie, articles: [{ ...interne.articles[0], keywords: ['potable', 'eau du robinet'] }] };
  assert.equal(defautManifeste(avec), null);
  const { archive: _a, ...interneAvec } = avec;
  const entrees = [{ nom: 'manifest.json', contenu: JSON.stringify(interneAvec) }, ...bon.slice(1)];
  const index = construireIndex(avec, validerArchive(lireTarGz(tar(entrees)), avec));
  assert.deepEqual(index.articles[0].keywords, ['potable', 'eau du robinet']);
  assert.deepEqual(construireIndex(publie, validerArchive(lireTarGz(tar(bon)), publie)).articles[0].keywords, []);
});


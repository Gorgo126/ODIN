// Tests of the message wall (lib/messages.mjs): cleaning, limits, rate limit, since/generation,
// purge, deletion, survival of the base. Needs Node 22.13+ (node:sqlite), e.g. in the dashboard container:
// docker cp tests/messages.test.mjs dashboard:/app/tests-messages.mjs && docker exec dashboard sh -c 'cd /app && sed -i "s#../dashboard/lib#./lib#" tests-messages.mjs && node --test tests-messages.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

process.env.MESSAGES_DOSSIER = mkdtempSync(path.join(tmpdir(), 'mur-'));
const m = await import('../dashboard/lib/messages.mjs');
let ip = 0;
const autreIp = () => `10.0.0.${++ip}`;

test('nettoyage : texte brut, contrôles retirés, lignes gardées', () => {
  assert.equal(m.nettoyerTexte('  a\r\nb\u0000c‮d\n\n\n\ne  '), 'a\nbcd\n\ne');
  assert.equal(m.nettoyerPseudo(' Jean\n\tPaul '), 'Jean Paul');
  assert.equal(m.nettoyerTexte('<b>gras</b>'), '<b>gras</b>');
});

test('limites : pseudo, vide, 500 caractères (en caractères, pas en octets)', () => {
  assert.equal(m.publier({ pseudo: '', texte: 'x' }, autreIp()).statut, 400);
  assert.equal(m.publier({ pseudo: 'a', texte: '   ' }, autreIp()).statut, 400);
  assert.equal(m.publier({ pseudo: 'a'.repeat(31), texte: 'x' }, autreIp()).statut, 400);
  assert.equal(m.publier({ pseudo: 'a', texte: 'é'.repeat(501) }, autreIp()).statut, 400);
  assert.ok(m.publier({ pseudo: 'a', texte: '💧'.repeat(500) }, autreIp()).message);
});

test('un message toutes les 3 s par adresse', () => {
  const a = autreIp();
  assert.ok(m.publier({ pseudo: 'a', texte: 'un' }, a).message);
  assert.equal(m.publier({ pseudo: 'a', texte: 'deux' }, a).statut, 429);
  assert.ok(m.publier({ pseudo: 'b', texte: 'trois' }, autreIp()).message);
});

test('suite par since et génération, rechargement complet après suppression', () => {
  const tout = m.lireMessages(NaN, NaN);
  assert.equal(tout.complet, true);
  assert.ok(tout.messages[0].id > tout.messages[1].id, 'le plus récent d\'abord');
  const dernier = tout.messages[0].id;
  const r = m.publier({ pseudo: 'c', texte: 'nouveau' }, autreIp());
  const suite = m.lireMessages(dernier, tout.generation);
  assert.equal(suite.complet, false);
  assert.deepEqual(suite.messages.map((x) => x.id), [r.message.id]);
  assert.equal(typeof suite.maintenant, 'number');
  assert.ok(m.supprimer(r.message.id));
  assert.equal(m.supprimer(r.message.id), false);
  const apres = m.lireMessages(dernier, tout.generation);
  assert.equal(apres.complet, true, 'génération changée : tout est renvoyé');
  assert.ok(!apres.messages.some((x) => x.id === r.message.id));
});

test('purge : plus de 2000 messages', () => {
  for (let i = 0; i < 2005; i++) m.publier({ pseudo: 'p', texte: `n${i}` }, autreIp());
  const { messages } = m.lireMessages(NaN, NaN);
  assert.equal(messages.length, 2000);
  assert.equal(messages[0].texte, 'n2004');
});

test('purge : messages de plus de 30 jours', () => {
  const vrai = Date.now;
  Date.now = () => vrai() + 31 * 24 * 3600 * 1000;
  try {
    m.publier({ pseudo: 'p', texte: 'plus tard' }, autreIp());
    const { messages } = m.lireMessages(NaN, NaN);
    assert.deepEqual(messages.map((x) => x.texte), ['plus tard']);
  } finally {
    Date.now = vrai;
  }
});

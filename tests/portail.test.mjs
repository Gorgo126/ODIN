// Tests of the captive portal table (lot 2): exact answers of every probe, host normalisation,
// release and range. No dependency: node --test tests/portail.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trouverSonde, normaliserHote, liberer, estLibere, dansReseau } from '../dashboard/lib/portail.mjs';

const APPLE = '<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>';
const attendus = [
  ['connectivitycheck.gstatic.com', '/generate_204', 204, ''],
  ['www.google.com', '/gen_204', 204, ''],
  ['www.google.com', '/generate_204', 204, ''],
  ['clients3.google.com', '/generate_204', 204, ''],
  ['play.googleapis.com', '/generate_204', 204, ''],
  ['captive.apple.com', '/hotspot-detect.html', 200, `${APPLE}\n`],
  ['www.apple.com', '/library/test/success.html', 200, APPLE],
  ['www.msftconnecttest.com', '/connecttest.txt', 200, 'Microsoft Connect Test'],
  ['www.msftncsi.com', '/ncsi.txt', 200, 'Microsoft NCSI'],
  ['firefox-portal-detection.com', '/generate_204', 204, ''],
  ['firefox-portal-detection.com', '/success.txt', 200, 'success\n'],
  ['detectportal.firefox.com', '/success.txt', 200, 'success\n'],
  ['detectportal.firefox.com', '/canonical.html', 200, '<meta http-equiv="refresh" content="0;url=https://support.mozilla.org/kb/captive-portal"/>'],
  ['connectivity-check.ubuntu.com', '/', 204, ''],
  ['nmcheck.gnome.org', '/check_network_status.txt', 200, 'NetworkManager is online'],
  ['fedoraproject.org', '/static/hotspot.txt', 200, 'OK']
];

test('chaque sonde a sa réponse exacte', () => {
  for (const [hote, chemin, statut, corps] of attendus) {
    const r = trouverSonde(hote, chemin);
    assert.ok(r, `${hote}${chemin} inconnue`);
    assert.equal(r.statut, statut, `${hote}${chemin}`);
    assert.equal(r.corps, corps, `${hote}${chemin}`);
  }
});

test('tailles des corps comme les serveurs officiels', () => {
  assert.equal(Buffer.byteLength(trouverSonde('captive.apple.com', '/hotspot-detect.html').corps), 69);
  assert.equal(Buffer.byteLength(trouverSonde('www.apple.com', '/library/test/success.html').corps), 68);
  assert.equal(Buffer.byteLength(trouverSonde('www.msftconnecttest.com', '/connecttest.txt').corps), 22);
  assert.equal(Buffer.byteLength(trouverSonde('detectportal.firefox.com', '/canonical.html').corps), 90);
});

test('hôte : casse, port, point final ; chemin : requête ignorée', () => {
  assert.equal(normaliserHote('Connectivity-Check.Ubuntu.com.:80'), 'connectivity-check.ubuntu.com');
  assert.ok(trouverSonde('connectivity-check.ubuntu.com.', '/'));
  assert.ok(trouverSonde('firefox-portal-detection.com', '/success.txt?ipv4'));
  assert.ok(trouverSonde('captive.apple.com', '/un/chemin/quelconque.html'));
});

test('inconnues : autre chemin, autre hôte', () => {
  assert.equal(trouverSonde('www.google.com', '/search'), null);
  assert.equal(trouverSonde('exemple.org', '/'), null);
  assert.equal(trouverSonde('www.msftconnecttest.com', '/redirect'), null);
});

test('libération : 12 h', () => {
  const t = Date.now();
  assert.equal(estLibere('10.42.0.50', t), false);
  liberer('10.42.0.50', t);
  assert.equal(estLibere('10.42.0.50', t + 11 * 3600e3), true);
  assert.equal(estLibere('10.42.0.50', t + 13 * 3600e3), false);
});

test('plage du réseau Wi-Fi', () => {
  assert.equal(dansReseau('10.42.0.42', '10.42.0.0/24'), true);
  assert.equal(dansReseau('10.42.1.42', '10.42.0.0/24'), false);
  assert.equal(dansReseau('192.168.129.10', '10.42.0.0/24'), false);
  assert.equal(dansReseau('10.42.0.42', '192.0.2.0/32'), false);
  assert.equal(dansReseau('', '10.42.0.0/24'), false);
  assert.equal(dansReseau('10.42.0.42', undefined), false);
});

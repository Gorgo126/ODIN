// Captive portal of the Wi-Fi access point (option POINT_ACCES, docs/conception-point-acces.md, lot 2).
// Caddy sends here every request of a Wi-Fi device for another site (/api/portail/sonde). A device not
// released yet is sent to /portail; once released (« Continuer »), the connectivity probes of its
// system get the exact answer they expect, and it considers the network connected (except Android:
// its HTTPS probe cannot succeed offline, « limited connectivity »).
//
// THE one table of the known probes. Answers checked in the source code or official documentation of
// each system on 2026-09-25 (see CLAUDE.md, « Point d'accès Wi-Fi ») and against the live servers.
import { lireJson } from './fichiers.mjs';

const APPLE = '<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>';
const vide = { statut: 204, corps: '' };
const texte = (corps, type = 'text/plain') => ({ statut: 200, corps, type });
const TOUT = '*';

export const SONDES = [
  // Android, AOSP NetworkStack (config.xml, CaptivePortalProbeResult: 204 only; a 302 is a portal).
  // clients3.google.com and clients1: older versions
  { hotes: ['connectivitycheck.gstatic.com', 'connectivitycheck.android.com', 'clients3.google.com', 'clients1.google.com', 'play.googleapis.com', 'www.google.com'],
    chemins: ['/generate_204', '/gen_204'], reponse: vide },
  // Apple: captive.apple.com (Apple Support « Use Apple products on enterprise networks »), any path; the
  // exact matching rule is not published. Bodies as served by Apple (69 bytes with \n, 68 without)
  { hotes: ['captive.apple.com'], chemins: TOUT, reponse: texte(`${APPLE}\n`, 'text/html') },
  { hotes: ['www.apple.com'], chemins: ['/library/test/success.html'], reponse: texte(APPLE, 'text/html') },
  // Older Apple probe hosts: secondary sources only, kept so that a released device is never sent back
  // to the portal by a probe we do not know
  { hotes: ['www.appleiphonecell.com', 'www.itools.info', 'www.ibook.info', 'www.airport.us', 'www.thinkdifferent.us'],
    chemins: TOUT, reponse: texte(`${APPLE}\n`, 'text/html') },
  // Windows NCSI (Microsoft Learn: HTTP 200 and « Microsoft Connect Test » in the payload)
  { hotes: ['www.msftconnecttest.com', 'ipv6.msftconnecttest.com'], chemins: ['/connecttest.txt'], reponse: texte('Microsoft Connect Test') },
  { hotes: ['www.msftncsi.com'], chemins: ['/ncsi.txt'], reponse: texte('Microsoft NCSI') },
  // Firefox (all.js, CaptiveDetect.sys.mjs): release ≥ 157 empty 200/204, ESR 140 the exact canonical
  // page; connectivity service: success of the request only
  { hotes: ['firefox-portal-detection.com'], chemins: ['/generate_204'], reponse: vide },
  { hotes: ['firefox-portal-detection.com', 'detectportal.firefox.com'], chemins: ['/success.txt'], reponse: texte('success\n') },
  { hotes: ['detectportal.firefox.com'], chemins: ['/canonical.html'],
    reponse: texte('<meta http-equiv="refresh" content="0;url=https://support.mozilla.org/kb/captive-portal"/>', 'text/html') },
  // NetworkManager (nm-connectivity.c: the X-NetworkManager-Status header alone is enough, added to
  // every answer below; otherwise the body is compared on its start, or 204 when no response is set)
  { hotes: ['connectivity-check.ubuntu.com'], chemins: TOUT, reponse: vide },
  { hotes: ['nmcheck.gnome.org'], chemins: ['/check_network_status.txt'], reponse: texte('NetworkManager is online') },
  { hotes: ['ping.archlinux.org'], chemins: ['/nm-check.txt'], reponse: texte('NetworkManager is online') },
  { hotes: ['fedoraproject.org'], chemins: ['/static/hotspot.txt'], reponse: texte('OK') }
];

// « Connectivity-Check.Ubuntu.com.:80 » → « connectivity-check.ubuntu.com » (Ubuntu's NM asks with the
// final dot)
export function normaliserHote(h) {
  return String(h || '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

// Expected answer of a known probe, or null
export function trouverSonde(hote, chemin) {
  const h = normaliserHote(hote);
  const c = String(chemin || '/').split('?')[0];
  const s = SONDES.find((x) => x.hotes.includes(h) && (x.chemins === TOUT || x.chemins.includes(c)));
  return s ? s.reponse : null;
}

// Released devices: IP → end, 12 h (the DHCP lease). In globalThis (separate bundles of the routes);
// lost when the dashboard restarts: the device sees the portal again, accepted.
const DUREE = 12 * 3600 * 1000;
const liberes = globalThis.__odinPortail ??= new Map();

export function liberer(ip, maintenant = Date.now()) {
  liberes.set(ip, maintenant + DUREE);
}

export function estLibere(ip, maintenant = Date.now()) {
  const fin = liberes.get(ip);
  if (!fin) return false;
  if (fin > maintenant) return true;
  liberes.delete(ip);
  return false;
}

// Is ip in « 10.42.0.0/24 »? (range of the Wi-Fi network, PORTAIL_RESEAU)
const nombre = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
export function dansReseau(ip, cidr) {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr || '');
  if (!m || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip || '')) return false;
  const bits = Number(m[2]);
  const masque = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return ((nombre(ip) & masque) >>> 0) === ((nombre(m[1]) & masque) >>> 0);
}

// Client IP as set by Caddy (it does not trust an X-Forwarded-For sent by the client)
export const ipClient = (requete) => (requete.headers.get('x-forwarded-for') || '').split(',')[0].trim();

// State of the access point, written by scripts/point-acces.sh (the dashboard never writes it)
export const etatPointAcces = () => lireJson('/config/point-acces.json', null);

export async function adresseOdin() {
  return (await etatPointAcces())?.adresse || null;
}

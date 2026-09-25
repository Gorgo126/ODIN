import { promises as fs } from 'fs';
import os from 'os';
import { espaceDisque } from './etat.mjs';
import { lireJson } from './fichiers.mjs';
import { niveauDisque } from './format.mjs';

// Health of the server (/sante and the status strip of the home page). Memory, load and uptime come
// from /proc: Docker does not virtualise these files, the container reads those of the host (checked
// against the host). Containers come from the socket proxy (service socket-proxy, internal network
// « sante »), which only lets GET /containers/json and GET /info through. No call leaves the server.
const DOCKER = process.env.DOCKER_URL || 'http://socket-proxy:2375';
const DELAI = 2000;
// Several pages open at once share one reading
const memo = globalThis.__odinSante ??= { t: 0, p: null };
const FRAICHEUR = 2000;

async function memoire() {
  const texte = await fs.readFile('/proc/meminfo', 'utf8');
  const kio = (nom) => Number(texte.match(new RegExp(`^${nom}:\\s+(\\d+)`, 'm'))?.[1] || 0) * 1024;
  const total = kio('MemTotal');
  const disponible = kio('MemAvailable');
  return { total, disponible, utilisee: total - disponible };
}

async function systeme() {
  const [disque, ram, charge, uptime] = await Promise.all([
    espaceDisque(),
    memoire().catch(() => null),
    fs.readFile('/proc/loadavg', 'utf8').then((t) => t.split(' ').slice(0, 3).map(Number), () => null),
    fs.readFile('/proc/uptime', 'utf8').then((t) => Math.floor(Number(t.split(' ')[0])), () => null)
  ]);
  return {
    disque: disque && { ...disque, pct: Math.round((disque.utilise / disque.total) * 100) },
    ram,
    charge,
    coeurs: os.availableParallelism(),
    uptime
  };
}

async function docker(chemin) {
  const r = await fetch(DOCKER + chemin, { signal: AbortSignal.timeout(DELAI), cache: 'no-store' });
  if (!r.ok) throw new Error(`proxy Docker : ${r.status}`);
  return r.json();
}

// « Up 3 hours (healthy) », « Exited (0) 5 minutes ago », « Up About a minute »: the duration, in
// French. /containers/json gives no start date (only the inspection does, which the proxy refuses).
const UNITES = { second: 's', minute: 'min', hour: 'h', day: 'j', week: 'sem.', month: 'mois', year: 'an' };
function duree(statut) {
  const m = statut.match(/(\d+|About an?|Less than a) (second|minute|hour|day|week|month|year)s?/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? m[1] : m[1].startsWith('Less') ? '< 1' : '1';
  const u = UNITES[m[2]];
  return `${n} ${u === 'an' && n !== '1' && n !== '< 1' ? 'ans' : u}`;
}

// « ghcr.io/kiwix/kiwix-serve:3.8.2 » → image and tag; a digest (@sha256:…) is dropped from the tag.
// An image whose tag was moved to another image since the start only has its identifier.
function image(c) {
  if (c.Image.startsWith('sha256:')) return { image: 'image remplacée depuis le démarrage', tag: c.ImageID?.slice(7, 19) || '' };
  const [nom] = c.Image.split('@');
  const i = nom.lastIndexOf(':');
  return i > nom.lastIndexOf('/') ? { image: nom.slice(0, i), tag: nom.slice(i + 1) } : { image: nom, tag: 'latest' };
}

function sante(c) {
  const s = c.Health?.Status;
  if (s && s !== 'none') return s;
  // Docker before API 1.52: the health is only in the status text
  return c.Status.match(/\((healthy|unhealthy|health: starting)\)/)?.[1]?.replace('health: ', '') || null;
}

async function conteneurs() {
  try {
    const [liste, info] = await Promise.all([docker('/containers/json?all=1'), docker('/info').catch(() => null)]);
    // Only the containers of ODIN's Compose project, found from the dashboard's own container
    // (its hostname is the start of its identifier)
    const moi = liste.find((c) => c.Id.startsWith(os.hostname()));
    const projet = moi?.Labels?.['com.docker.compose.project'];
    const siens = projet ? liste.filter((c) => c.Labels?.['com.docker.compose.project'] === projet) : liste;
    return {
      disponible: true,
      docker: info?.ServerVersion || null,
      liste: siens.map((c) => ({
        nom: (c.Names?.[0] || c.Id.slice(0, 12)).replace(/^\//, ''),
        service: c.Labels?.['com.docker.compose.service'] || null,
        etat: c.State,
        sante: sante(c),
        ...image(c),
        depuis: duree(c.Status),
        statut: c.Status
      })).sort((a, b) => a.nom.localeCompare(b.nom))
    };
  } catch {
    return { disponible: false };
  }
}

// Written by install.sh after the clone: { commit, branche, installe }. Absent on an installation
// made before this file, and not updated by a plain git pull (then it is the last installer run).
const version = () => lireJson('/config/version', null);

// neutre, alerte or critique, with the reasons, for the strip and the page
function niveau(s, c) {
  const raisons = [];
  let n = '';
  const monter = (v, raison) => { raisons.push(raison); if (v === 'critique' || !n) n = v; };
  const d = s.disque ? niveauDisque(s.disque.pct) : '';
  if (d) monter(d, `Disque rempli à ${s.disque.pct} %`);
  if (!c.disponible) monter('alerte', 'État des conteneurs indisponible');
  for (const x of c.liste || []) {
    if (x.etat === 'restarting') monter('critique', `${x.nom} redémarre en boucle`);
    else if (x.etat !== 'running') monter('critique', `${x.nom} arrêté`);
    else if (x.sante === 'unhealthy') monter('critique', `${x.nom} en mauvaise santé`);
  }
  return { niveau: n || 'neutre', raisons };
}

async function mesurer() {
  const [s, c, v] = await Promise.all([systeme(), conteneurs(), version()]);
  const moi = c.liste?.find((x) => x.service === 'dashboard');
  return {
    systeme: s,
    conteneurs: c,
    version: { odin: v, dashboard: moi ? moi.tag : null },
    ...niveau(s, c),
    mesure: Date.now()
  };
}

export async function etatSante() {
  if (Date.now() - memo.t > FRAICHEUR) {
    memo.t = Date.now();
    memo.p = mesurer();
  }
  return memo.p;
}

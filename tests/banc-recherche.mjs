// Search benchmark: the questions of tests/banc-recherche.json through /api/recherche (route, index,
// every source), compared with the expected ranking. Runs inside the dashboard container (Node only, no
// dependency), started by scripts/banc-recherche.sh. Plain text output.
// Exit code: 0 = every expectation met, 1 = regression, 2 = benchmark not applicable (a pack, book or
// article the expectations need is missing, dashboard not answering). Another version of the articles
// than the reference one is only a warning: the site's content evolves.
import { readFileSync, realpathSync } from 'fs';

const B = 'http://127.0.0.1:3000';
const banc = JSON.parse(readFileSync(process.argv[2] || '/tmp/banc-recherche.json', 'utf8'));
const ORIGINES = { wiki: 'wiki', livre: 'livre', 'comment-faire': 'comment-faire' };
const lire = async (chemin) => {
  const r = await fetch(B + chemin, { cache: 'no-store', signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`${chemin} : HTTP ${r.status}`);
  return r.json();
};

// Content the expectations were written for: without it, a failure says nothing about the search
async function requis() {
  const manque = [];
  const packs = await lire('/api/packs');
  for (const id of banc.requis.packs || []) if (packs.find((p) => p.id === id)?.installation !== 'installe') manque.push(`pack ${id}`);
  const livres = await lire('/api/livres');
  for (const id of banc.requis.livres || []) if (!livres.find((l) => l.id === id)?.installe) manque.push(`livre ${id}`);
  // The installed articles, by identifier (index of the installed version, read in the container)
  let installes = [];
  let version = null;
  try {
    const g = JSON.parse(readFileSync(`${realpathSync('/config/guides/actuel')}/guides.json`, 'utf8'));
    installes = g.articles.map((a) => a.slug);
    version = g.version;
  } catch {}
  for (const slug of banc.requis.articles || []) if (!installes.includes(slug)) manque.push(`article ${slug}`);
  const avertissements = [];
  if (banc.requis.guidesReference && version && version !== banc.requis.guidesReference) {
    avertissements.push(`articles « Comment faire ? » en version ${version}, attentes écrites avec ${banc.requis.guidesReference} : à surveiller, pas bloquant`);
  }
  return { manque, avertissements };
}

const nom = (g) => `${g.origine === 'wiki' ? g.etiquette : g.origine === 'livre' ? 'Livre' : 'Comment faire ?'} · ${g.titre}`;
const note = (g) => {
  const d = g.passages[0]?.debug;
  return d ? (d.cosinus + (d.ajustement || 0)).toFixed(3) : '?';
};

function verifier(a, groupes) {
  const vise = groupes.filter((g) => g.origine === ORIGINES[a.source] && (!a.titre || g.titre.startsWith(a.titre)));
  const cible = vise[0];
  const rang = cible ? groupes.indexOf(cible) + 1 : null;
  const libelle = a.titre ? `${a.source} « ${a.titre} »` : `source ${a.source}`;
  if (a.absent) return cible ? `${libelle} ne devrait pas sortir : ${cible.niveau}, rang ${rang}` : null;
  if (a.pasFort) {
    const fort = vise.find((g) => g.niveau === 'fort');
    return fort ? `${libelle} ne devrait pas être fort : ${nom(fort)} fort, rang ${groupes.indexOf(fort) + 1}` : null;
  }
  if (!cible) return `${libelle} absent (attendu ${a.niveau || 'présent'})`;
  if (a.niveau === 'fort' && cible.niveau !== 'fort') return `${libelle} ${cible.niveau} au lieu de fort`;
  if (a.niveau === 'proche' && cible.niveau !== 'proche') return `${libelle} ${cible.niveau} au lieu de proche`;
  if (a.rangMax && rang > a.rangMax) return `${libelle} rang ${rang} (attendu ${a.rangMax} au plus)`;
  if (a.tete && groupes.find((g) => g.origine === ORIGINES[a.source]) !== cible) return `${libelle} n'est pas le premier de sa source`;
  return null;
}

(async () => {
  let manque;
  let avertissements;
  try {
    ({ manque, avertissements } = await requis());
  } catch (e) {
    console.log(`Banc non applicable : dashboard injoignable (${e.message}).`);
    process.exit(2);
  }
  if (manque.length) {
    console.log(`Banc non applicable : contenu manquant : ${manque.join(', ')}.`);
    process.exit(2);
  }
  for (const a of avertissements) console.log(`Avertissement : ${a}.\n`);
  let attentes = 0;
  let echecs = 0;
  const t0 = Date.now();
  for (const { q, attentes: liste } of banc.questions) {
    const r = await lire(`/api/recherche?debug=1&q=${encodeURIComponent(q)}`);
    const groupes = [...(r.forts || []), ...(r.proches || [])];
    const problemes = liste.map((a) => verifier(a, groupes)).filter(Boolean);
    attentes += liste.length;
    echecs += problemes.length;
    console.log(`${problemes.length ? 'ÉCHEC' : 'ok   '} « ${q} »`);
    for (const p of problemes) console.log(`      ✗ ${p}`);
    if (problemes.length || process.env.DETAIL) {
      groupes.slice(0, 5).forEach((g, i) => console.log(`      ${i + 1}. [${g.niveau}] ${nom(g)} ${note(g)}`));
      if (!groupes.length) console.log('      (aucun résultat)');
    }
  }
  console.log(`\n${banc.questions.length} questions, ${attentes} attentes, ${echecs} échec(s), ${Math.round((Date.now() - t0) / 1000)} s${avertissements.length ? `, ${avertissements.length} avertissement(s)` : ''}.`);
  process.exit(echecs ? 1 : 0);
})().catch((e) => {
  console.log(`Banc interrompu : ${e.message}`);
  process.exit(2);
});

#!/usr/bin/env bash
# Adds a Kiwix pack from the command line, through the dashboard itself: its API, called inside its
# container (no password needed there). Same catalogue, mirrors, throughput test, SHA-256, disk space
# check and library.xml as the Configuration page; nothing is copied here. The dashboard must run.
#
#   scripts/ajouter.sh --liste      packs of catalogue/packs.txt, their size and state
#   scripts/ajouter.sh <id>         downloads and installs the pack, with its progress
#
# Ctrl+C stops the display only: the download goes on in ODIN (Configuration → Encyclopédie).
set -euo pipefail

CONTENEUR=dashboard
if ! docker inspect -f '{{.State.Running}}' "$CONTENEUR" 2>/dev/null | grep -q true; then
  echo "Le dashboard d'ODIN ne tourne pas (docker compose up -d dans /opt/odin, puis relancez)." >&2
  exit 1
fi

trap 'echo; echo "Affichage arrêté : le téléchargement continue dans ODIN (Configuration → Encyclopédie)."; exit 0' INT

# The same small program for both uses: listing, or installing and following one pack
docker exec -i "$CONTENEUR" node - "${1:---liste}" <<'JS'
const API = 'http://127.0.0.1:3000/api/packs';
const arg = process.argv[2];
const taille = (n) => {
  if (!n) return '?';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};
const lire = async () => (await fetch(API, { cache: 'no-store' })).json();

(async () => {
  if (arg === '--liste') {
    const packs = await lire();
    console.log('Packs disponibles :');
    for (const p of packs) {
      const etat = p.tache?.etat === 'en cours' ? 'en cours' : p.installation === 'installe' ? 'installé'
        : p.installation === 'maj' ? 'mise à jour disponible' : p.disponible === false ? 'introuvable' : '';
      console.log(`  ${p.id.padEnd(20)} ${taille(p.taille || p.derniereMesure).padStart(8)}  ${p.libelle}${etat ? ` [${etat}]` : ''}`);
    }
    console.log('\nInstaller : scripts/ajouter.sh <identifiant>');
    return;
  }
  const r = await fetch(`${API}/${encodeURIComponent(arg)}`, { method: 'POST' });
  const v = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(/inconnu/i.test(v.erreur || '') ? `${v.erreur} : ${arg} — voir scripts/ajouter.sh --liste` : v.erreur || `Erreur ${r.status}`);
    process.exit(1);
  }
  process.on('SIGINT', () => { console.log('\nAffichage arrêté : le téléchargement continue dans ODIN (Configuration → Encyclopédie).'); process.exit(0); });
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 2000));
    const p = (await lire()).find((x) => x.id === arg);
    const t = p?.tache;
    if (t?.etat === 'en cours') {
      const pct = t.total ? Math.floor((t.recu / t.total) * 100) : 0;
      process.stdout.write(`\r  ${t.verification ? 'Vérification de l\'empreinte…' : `${pct} % · ${taille(t.recu)} / ${taille(t.total)}`}      `);
      continue;
    }
    if (t?.etat === 'termine' || p?.installation === 'installe') { console.log(`\n${p.libelle} : installé.`); return; }
    console.error(`\n${t?.erreur || (t?.etat === 'annule' ? 'Téléchargement annulé.' : 'Échec du téléchargement.')}`);
    process.exit(1);
  }
})().catch((e) => { console.error(`Dashboard injoignable : ${e.message}`); process.exit(1); });
JS

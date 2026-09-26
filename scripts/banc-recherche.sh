#!/usr/bin/env bash
# Search benchmark on the test server: every question of tests/banc-recherche.json against the running
# dashboard, compared with the expected ranking. Any change to the search must pass it.
#
#   scripts/banc-recherche.sh                  every question; details of the failures only
#   DETAIL=1 scripts/banc-recherche.sh         the 5 first results of every question
#   scripts/banc-recherche.sh autre.json       another question file (same format)
#
# Exit code: 0 = no regression, 1 = regression, 2 = not applicable (content missing, dashboard down).
# From the PC: multipass exec odintest -- /opt/odin/scripts/banc-recherche.sh
set -euo pipefail

ODIN="$(cd "$(dirname "$0")/.." && pwd)"
QUESTIONS="${1:-$ODIN/tests/banc-recherche.json}"
CONTENEUR=dashboard

if ! docker inspect -f '{{.State.Running}}' "$CONTENEUR" 2>/dev/null | grep -q true; then
  echo "Banc non applicable : le dashboard ne tourne pas."
  exit 2
fi
# The runner and the questions come from the repository, not from the image: no rebuild needed
docker cp "$ODIN/tests/banc-recherche.mjs" "$CONTENEUR:/tmp/banc-recherche.mjs" >/dev/null
docker cp "$QUESTIONS" "$CONTENEUR:/tmp/banc-recherche.json" >/dev/null
code=0
docker exec -e DETAIL="${DETAIL:-}" "$CONTENEUR" node /tmp/banc-recherche.mjs /tmp/banc-recherche.json || code=$?
docker exec "$CONTENEUR" rm -f /tmp/banc-recherche.mjs /tmp/banc-recherche.json
exit "$code"

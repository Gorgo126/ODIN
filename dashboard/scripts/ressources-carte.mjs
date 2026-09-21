// Copies MapLibre's ESM build into public/ before next build. Loaded as-is by the map page,
// it resolves its worker next to itself; bundled by webpack, it would lose that path.
import { cpSync, mkdirSync } from 'fs';

const source = 'node_modules/maplibre-gl/dist';
const cible = 'public/ressources-carte/maplibre';
mkdirSync(cible, { recursive: true });
for (const f of ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css']) {
  cpSync(`${source}/${f}`, `${cible}/${f}`);
}

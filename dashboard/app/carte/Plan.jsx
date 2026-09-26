'use client';
import { useEffect, useRef, useState } from 'react';
import { useLiaison, messageHorsLigne } from '../useLiaison';

// Served as-is from public/: MapLibre finds its worker next to its own file
const RESSOURCES = '/ressources-carte';
// OpenStreetMap data (ODbL 1.0) in Protomaps tiles. Always shown (licence); its links are external,
// greyed and blocked offline like those of the reader (data-externe)
const ATTRIBUTION = '© <a href="https://openstreetmap.org/copyright" data-externe="">contributeurs d\'OpenStreetMap</a> (<a href="https://opendatacommons.org/licenses/odbl/" data-externe="">ODbL</a>) · <a href="https://protomaps.com" data-externe="">Protomaps</a>';

// Opening view when the address holds none: Europe
const VUE_INITIALE = [[-11, 35], [32, 61]];

const aire = (h) => (h.maxLon - h.minLon) * (h.maxLat - h.minLat);

export default function Plan({ packs, liaisonInitiale }) {
  const conteneur = useRef(null);
  const [erreur, setErreur] = useState('');
  const [avis, setAvis] = useState(false);
  const liaison = useLiaison(liaisonInitiale);
  const horsLiaison = !liaison?.enLigne;

  function cliquer(e) {
    if (horsLiaison && e.target.closest('a[data-externe]')) {
      e.preventDefault();
      setAvis(true);
      setTimeout(() => setAvis(false), 4000);
    }
  }

  useEffect(() => {
    if (!packs.length) return;
    let fini = false;
    let carte;
    let maplibre;

    (async () => {
      try {
        const [ml, { Protocol, PMTiles }, { layers, namedFlavor }] = await Promise.all([
          import(/* webpackIgnore: true */ `${RESSOURCES}/maplibre/maplibre-gl.mjs`),
          import('pmtiles'),
          import('@protomaps/basemaps')
        ]);
        if (fini) return;
        maplibre = ml;
        const protocole = new Protocol();
        ml.addProtocol('pmtiles', protocole.tile);

        // Least detailed first: each pack is drawn over the ones below it
        const archives = (await Promise.all(packs.map(async (p) => {
          const archive = new PMTiles(location.origin + p.url);
          try {
            const h = await archive.getHeader();
            protocole.add(archive);
            return { id: p.id, cle: archive.source.getKey(), h };
          } catch {
            return null;
          }
        }))).filter(Boolean).sort((a, b) => a.h.maxZoom - b.h.maxZoom || aire(b.h) - aire(a.h));
        if (fini) return;
        if (!archives.length) throw new Error('Aucune carte lisible.');

        // Regional packs start where the base stops, so low zooms draw the base alone
        const zoomBase = archives[0].h.maxZoom;
        const theme = namedFlavor('dark');
        const sources = {};
        const fonds = [];
        const textes = [];
        archives.forEach(({ id, cle, h }, i) => {
          const source = `odin-${id}`;
          sources[source] = {
            type: 'vector',
            tiles: [`pmtiles://${cle}/{z}/{x}/{y}`],
            minzoom: i === 0 ? 0 : Math.min(zoomBase, h.maxZoom),
            maxzoom: h.maxZoom,
            bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
            attribution: ATTRIBUTION
          };
          for (const couche of layers(source, theme, { lang: 'fr' })) {
            if (couche.type === 'background' && i > 0) continue;
            const c = { ...couche, id: `${id}-${couche.id}` };
            // Opaque land and water of a detailed pack hide the less detailed ones below;
            // labels all go on top, the most detailed winning collisions
            (couche.type === 'symbol' ? textes : fonds).push(c);
          }
        });

        carte = new ml.Map({
          container: conteneur.current,
          style: {
            version: 8,
            glyphs: `${location.origin}${RESSOURCES}/polices/{fontstack}/{range}.pbf`,
            sprite: `${location.origin}${RESSOURCES}/sprites/dark`,
            sources,
            layers: [...fonds, ...textes]
          },
          hash: true,
          maxZoom: 19,
          attributionControl: { compact: true },
          ...(location.hash ? {} : { bounds: VUE_INITIALE })
        });
        carte.addControl(new ml.NavigationControl());
        carte.addControl(new ml.ScaleControl({ unit: 'metric' }));
      } catch (e) {
        if (!fini) setErreur(`La carte n'a pas pu s'afficher : ${e.message}`);
      }
    })();

    return () => {
      fini = true;
      carte?.remove();
      maplibre?.removeProtocol('pmtiles');
    };
  }, [packs]);

  return (
    // The class sits on the frame: MapLibre owns the classes of its own container
    <div className={`cadre${horsLiaison ? ' hors-liaison' : ''}`} onClickCapture={cliquer}>
      <link rel="stylesheet" href={`${RESSOURCES}/maplibre/maplibre-gl.css`} precedence="default" />
      <nav className="barre">
        <a href="/" className="accueil">ODIN</a>
        <span className="sep">/</span>
        <span>Cartes</span>
        <a className="externe" href="/configuration">Gérer les cartes</a>
      </nav>
      {!packs.length && (
        <p className="plan-message">
          Aucune carte installée. Ajoutez-en depuis <a href="/configuration">Configuration</a>, section Cartes.
        </p>
      )}
      {avis && <p className="avis-liaison plan-avis">Lien externe : {messageHorsLigne(liaison).toLowerCase()}.</p>}
      {erreur && <p className="plan-message">{erreur}</p>}
      {packs.length > 0 && <div ref={conteneur} className="plan" />}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { motsRequete, normaliserAvecCarte, positions } from '../../../lib/normalisation.mjs';

// Words of the search highlighted on the opened page only, in pdf.js' own text layer. The
// viewer's find (#search=) is not used: it reads every page, so it downloads the whole book.
// Returns true when a word was found. The text layer is rebuilt on zoom: highlighted again then.
function surligner(doc, page, mots, defiler) {
  const couche = doc.querySelector(`.page[data-page-number="${page}"] .textLayer`);
  if (!couche || couche.dataset.odinSurligne) return false;
  couche.dataset.odinSurligne = '1';
  let premier = null;
  for (const span of couche.querySelectorAll('span')) {
    if (span.children.length || !span.textContent) continue;
    const texte = span.textContent;
    const { n, carte } = normaliserAvecCarte(texte);
    const zones = mots.flatMap((m) => positions(n, m).map((i) => [carte[i], carte[i + m.length]])).sort((a, b) => a[0] - b[0]);
    if (!zones.length) continue;
    const morceaux = doc.createDocumentFragment();
    let curseur = 0;
    for (const [a, b] of zones) {
      if (a < curseur) continue;
      morceaux.append(texte.slice(curseur, a));
      const marque = doc.createElement('span');
      // pdf.js style for find results: colored box behind the transparent text
      marque.className = 'highlight appended';
      marque.textContent = texte.slice(a, b);
      morceaux.append(marque);
      premier ??= marque;
      curseur = b;
    }
    morceaux.append(texte.slice(curseur));
    span.replaceChildren(morceaux);
  }
  if (defiler) premier?.scrollIntoView({ block: 'center' });
  return !!premier;
}

// pdf.js viewer in a frame. The viewer announces itself to its same-origin parent with
// « webviewerloaded » before starting: options are set there, without touching its files.
// Range requests only (no full-file stream, no background fetch of the whole book), so a
// phone downloads the pages it shows, not the 13 MB of the PDF.
export default function Visionneuse({ src, titre, page, recherche }) {
  const [adresse, setAdresse] = useState(null);

  useEffect(() => {
    const mots = motsRequete(recherche);
    const regler = (e) => {
      const fenetre = e.detail?.source;
      const options = fenetre?.PDFViewerApplicationOptions;
      if (!options) return;
      options.set('disableStream', true);
      options.set('disableAutoFetch', true);
      if (!mots.length) return;
      const app = fenetre.PDFViewerApplication;
      // Scrolled to the first match once only, not again after each zoom
      let defiler = true;
      app.initializedPromise.then(() => {
        app.eventBus.on('textlayerrendered', (ev) => {
          if (ev.pageNumber === page && surligner(fenetre.document, page, mots, defiler)) defiler = false;
        });
      });
    };
    document.addEventListener('webviewerloaded', regler);
    // The frame is only created once the listener is in place
    setAdresse(src);
    return () => document.removeEventListener('webviewerloaded', regler);
  }, [src, page, recherche]);

  return adresse ? <iframe src={adresse} title={titre} allow="fullscreen" /> : null;
}

'use client';
import { useEffect, useState } from 'react';

// pdf.js viewer in a frame. The viewer announces itself to its same-origin parent with
// « webviewerloaded » before starting: options are set there, without touching its files.
// Range requests only (no full-file stream, no background fetch of the whole book), so a
// phone downloads the pages it shows, not the 13 MB of the PDF.
export default function Visionneuse({ src, titre }) {
  const [adresse, setAdresse] = useState(null);

  useEffect(() => {
    const regler = (e) => {
      const options = e.detail?.source?.PDFViewerApplicationOptions;
      if (!options) return;
      options.set('disableStream', true);
      options.set('disableAutoFetch', true);
    };
    document.addEventListener('webviewerloaded', regler);
    // The frame is only created once the listener is in place
    setAdresse(src);
    return () => document.removeEventListener('webviewerloaded', regler);
  }, [src]);

  return adresse ? <iframe src={adresse} title={titre} allow="fullscreen" /> : null;
}

'use client';
import { useMemo, useState } from 'react';

// Language names in French, from the browser itself (no data to download)
const noms = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['fr'], { type: 'language' }) : null;
const nom = (code) => {
  const n = noms?.of(code) || code;
  return n.charAt(0).toUpperCase() + n.slice(1);
};

async function appel(action, corps) {
  const r = await fetch(`/api/traduction/${action}`, corps
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) }
    : { cache: 'no-store' });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.erreur || `Erreur ${r.status}`);
  return d;
}

export default function Traducteur({ initiales, erreurInitiale, limite }) {
  const [liste, setListe] = useState(initiales);
  const [source, setSource] = useState('auto');
  const [cible, setCible] = useState(initiales?.some((l) => l.code === 'fr') ? 'fr' : initiales?.[0]?.code || '');
  const [texte, setTexte] = useState('');
  const [resultat, setResultat] = useState('');
  const [detectee, setDetectee] = useState(null);
  const [erreur, setErreur] = useState(erreurInitiale);
  const [occupe, setOccupe] = useState(false);

  const codes = useMemo(() => (liste || []).map((l) => l.code).sort((a, b) => nom(a).localeCompare(nom(b), 'fr')), [liste]);
  const cibles = codes.filter((c) => c !== source);

  async function recharger() {
    setErreur(null);
    try {
      const l = await appel('languages');
      setListe(l);
      if (!cible) setCible(l.some((x) => x.code === 'fr') ? 'fr' : l[0]?.code || '');
    } catch (e) {
      setErreur(e.message);
    }
  }

  async function traduire() {
    const q = texte.trim();
    if (!q || occupe || !cible) return;
    setOccupe(true);
    setErreur(null);
    try {
      const r = await appel('translate', { q, source, target: cible });
      setResultat(r.translatedText || '');
      setDetectee(source === 'auto' ? r.detectedLanguage?.language || null : null);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  }

  // Swaps languages and texts; from « automatic », the detected language becomes the target
  function inverser() {
    const nouvelleCible = source === 'auto' ? detectee : source;
    if (!nouvelleCible) return;
    setSource(cible);
    setCible(nouvelleCible);
    setTexte(resultat);
    setResultat(texte);
    setDetectee(null);
  }

  function changerSource(v) {
    setSource(v);
    setDetectee(null);
    if (v === cible) setCible(codes.find((c) => c !== v) || '');
  }

  if (!liste) {
    return (
      <div className="traduction-indisponible">
        <p className="erreur">{erreur}</p>
        <button onClick={recharger}>Réessayer</button>
      </div>
    );
  }

  return (
    <div className="traduction">
      <div className="traduction-langues">
        <select value={source} onChange={(e) => changerSource(e.target.value)} aria-label="Langue du texte">
          <option value="auto">{detectee ? `Détection : ${nom(detectee)}` : 'Détection automatique'}</option>
          {codes.map((c) => <option key={c} value={c}>{nom(c)}</option>)}
        </select>
        <button type="button" onClick={inverser} disabled={source === 'auto' && !detectee} title="Inverser les langues et les textes" aria-label="Inverser les langues">⇄</button>
        <select value={cible} onChange={(e) => setCible(e.target.value)} aria-label="Langue de la traduction">
          {cibles.map((c) => <option key={c} value={c}>{nom(c)}</option>)}
        </select>
      </div>

      <div className="traduction-zones">
        <div className="traduction-zone">
          <textarea
            value={texte} maxLength={limite} placeholder="Texte à traduire" aria-label="Texte à traduire"
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) traduire(); }}
          />
          <span className="compte">{texte.length} / {limite}</span>
        </div>
        <div className="traduction-zone">
          <textarea value={resultat} readOnly placeholder="Traduction" aria-label="Traduction" aria-busy={occupe} />
        </div>
      </div>

      <div className="traduction-actions">
        <button onClick={traduire} disabled={occupe || !texte.trim() || !cible}>{occupe ? 'Traduction…' : 'Traduire'}</button>
        <span className="compte">Ctrl + Entrée · hors ligne, sur ce serveur</span>
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      {source !== 'en' && cible !== 'en' && (source !== 'auto' || (detectee && detectee !== 'en')) && (
        <p className="compte">Traduction par l'anglais : un peu moins précise qu'une traduction directe.</p>
      )}
    </div>
  );
}

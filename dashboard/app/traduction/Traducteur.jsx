'use client';
import { useEffect, useMemo, useState } from 'react';

// Language names in French: from the catalogue, else from the browser itself (no data to download)
const intl = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['fr'], { type: 'language' }) : null;
let catalogue = {};
const nom = (code) => {
  const n = catalogue[code] || intl?.of(code) || code;
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

export default function Traducteur({ noms, initiales, rechargementInitial, erreurInitiale, limite }) {
  catalogue = noms || {};
  const [liste, setListe] = useState(initiales);
  const [source, setSource] = useState('auto');
  const [cible, setCible] = useState(initiales?.some((l) => l.code === 'fr') ? 'fr' : initiales?.[0]?.code || '');
  const [texte, setTexte] = useState('');
  const [resultat, setResultat] = useState('');
  const [detectee, setDetectee] = useState(null);
  const [erreur, setErreur] = useState(erreurInitiale);
  const [occupe, setOccupe] = useState(false);
  // LibreTranslate reloads its models after a language was added or removed: shown, never an error
  const [recharge, setRecharge] = useState(rechargementInitial);

  const codes = useMemo(() => (liste || []).map((l) => l.code).sort((a, b) => nom(a).localeCompare(nom(b), 'fr')), [liste]);
  const cibles = codes.filter((c) => c !== source);

  async function recharger() {
    setErreur(null);
    try {
      const { langues: l, rechargement } = await appel('languages');
      setRecharge(rechargement);
      if (!l) return;
      setListe(l);
      if (!cible || !l.some((x) => x.code === cible)) setCible(l.some((x) => x.code === 'fr') ? 'fr' : l[0]?.code || '');
      if (source !== 'auto' && !l.some((x) => x.code === source)) setSource('auto');
    } catch (e) {
      setErreur(e.message);
    }
  }

  useEffect(() => {
    if (!recharge) return;
    const t = setInterval(recharger, 2000);
    return () => clearInterval(t);
  });

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

  const bandeau = recharge && <p className="traduction-rechargement">Rechargement des langues…</p>;

  if (!liste) {
    if (recharge) return <div className="traduction-indisponible">{bandeau}</div>;
    return (
      <div className="traduction-indisponible">
        <p className="erreur">{erreur}</p>
        <button onClick={recharger}>Réessayer</button>
      </div>
    );
  }

  return (
    <div className="traduction">
      {bandeau}
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

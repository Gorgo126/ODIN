'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { octets } from '../../lib/format.mjs';
import { useLiaison, messageHorsLigne } from '../useLiaison';
import { suppressionGuides, supprimer } from '../../lib/suppressions.mjs';

// Installation, check and update of the « Comment faire ? » articles. On /comment-faire and in
// Configuration (with « Supprimer les articles »). Needs internet like every download of ODIN:
// greyed, never hidden, without it; the installed articles stay readable.

const SANS_INTERNET = 'Connexion à internet nécessaire pour installer ou mettre à jour';
const ETAPES = {
  manifeste: 'Lecture du manifeste',
  telechargement: 'Téléchargement',
  verification: 'Vérification de l\'empreinte',
  extraction: 'Extraction et contrôle de l\'archive',
  indexation: 'Préparation des articles et de la recherche'
};
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');

function Liste({ titre, articles }) {
  if (!articles.length) return null;
  return (
    <div className="guides-diff">
      <strong>{titre} ({articles.length})</strong>
      <ul>{articles.map((a) => <li key={a.slug}>{a.title}</li>)}</ul>
    </div>
  );
}

export default function Gestion({ initial, liaisonInitiale, avecSuppression = false }) {
  const router = useRouter();
  const [etat, setEtat] = useState(initial);
  const [diff, setDiff] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [verification, setVerification] = useState(false);
  const liaison = useLiaison(liaisonInitiale);
  const enLigne = !!liaison?.enLigne;
  const horsLigne = messageHorsLigne(liaison, SANS_INTERNET);
  const t = etat?.tache;
  const enCours = t?.etat === 'en cours';
  const installe = etat?.installe;

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/guides', { cache: 'no-store' });
      if (r.ok) setEtat(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (!enCours) return;
    const i = setInterval(charger, 1000);
    return () => clearInterval(i);
  }, [enCours, charger]);

  // Installation just over: the lists of the page are rendered by the server
  const precedent = useRef(enCours);
  useEffect(() => {
    if (precedent.current && !enCours) {
      if (t?.etat === 'termine') setDiff(null);
      router.refresh();
    }
    precedent.current = enCours;
  }, [enCours, t, router]);

  async function envoyer(action) {
    setErreur(null);
    try {
      const r = await fetch('/api/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.erreur);
      return v;
    } catch (e) {
      setErreur(e.message === 'Failed to fetch' ? 'Le serveur ne répond pas.' : e.message);
      return null;
    }
  }

  async function verifier() {
    setVerification(true);
    setDiff(null);
    const v = await envoyer('verifier');
    setVerification(false);
    if (v) setDiff(v);
  }

  async function installer() {
    if (await envoyer('installer')) charger();
  }

  async function retirer() {
    const r = await supprimer(suppressionGuides(installe));
    if (r && !r.ok) setErreur(r.erreur);
    if (r?.ok) {
      setDiff(null);
      await charger();
      router.refresh();
    }
  }

  const bloque = !enLigne || enCours;
  const titreBouton = enLigne ? undefined : horsLigne;
  const pct = t?.total ? Math.min(100, Math.floor((t.recu / t.total) * 100)) : 0;

  return (
    <div className="guides-gestion">
      {installe
        ? <p className="guides-etat">{installe.articles} articles installés · version {installe.version}, publiée le {date(installe.generated_at)}, installée le {date(installe.installeLe)} · {octets(installe.taille)}</p>
        : <p className="vide">Aucun article installé.</p>}

      {enCours && (
        <div className="progression">
          <div className="jauge"><div style={{ width: (t.etape === 'telechargement' ? pct : t.etape === 'manifeste' ? 0 : 100) + '%' }} /></div>
          <em>{ETAPES[t.etape] || 'Installation'}{t.etape === 'telechargement' && t.total ? ` · ${pct} % · ${octets(t.recu)} / ${octets(t.total)}` : ''}</em>
        </div>
      )}
      {!enCours && t?.etat === 'erreur' && <p className="erreur">{t.erreur}</p>}
      {erreur && <p className="erreur">{erreur}</p>}

      {diff && (
        diff.aJour
          ? <p className="guides-a-jour">Les articles sont à jour (version {diff.version}).</p>
          : (
            <div className="guides-maj">
              <p>{installe ? 'Une mise à jour est disponible' : 'Articles disponibles'} (version {diff.version}) :</p>
              <Liste titre="Nouveaux" articles={diff.nouveaux} />
              <Liste titre="Modifiés" articles={diff.modifies} />
              <Liste titre="Supprimés" articles={diff.supprimes} />
              {installe && <button disabled={bloque} title={titreBouton} onClick={installer}>Mettre à jour</button>}
            </div>
          )
      )}

      <div className="guides-boutons">
        {!installe && <button disabled={bloque} title={titreBouton} onClick={installer}>{t?.etat === 'erreur' ? 'Réessayer' : 'Installer les articles'}</button>}
        {installe && <button disabled={bloque || verification} title={titreBouton} onClick={verifier}>{verification ? 'Vérification…' : 'Vérifier les mises à jour'}</button>}
        {installe && t?.etat === 'erreur' && <button disabled={bloque} title={titreBouton} onClick={installer}>Réessayer</button>}
        {installe && avecSuppression && <button disabled={enCours} onClick={retirer}>Supprimer les articles</button>}
      </div>
      {!enLigne && <p className="hors-liaison">{horsLigne}.{installe ? ' Les articles installés restent lisibles.' : ''}</p>}
    </div>
  );
}

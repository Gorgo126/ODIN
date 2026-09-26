'use client';
import { useCallback, useEffect, useState } from 'react';
import { octets } from '../lib/format.mjs';
import { useLiaison, HORS_LIAISON } from './useLiaison';
import { suppressionLivre, supprimer } from '../lib/suppressions.mjs';

const CATEGORIES = { sante: 'Santé', eau: 'Eau', energie: 'Énergie', agriculture: 'Agriculture', technique: 'Technique' };

// Short author line: « Werner, Thuman, Maxwell »
const auteurs = (liste) => liste.map((a) => a.split(' ').at(-1)).join(', ');

export default function Livres({ liaisonInitiale }) {
  const [livres, setLivres] = useState(null);
  const enLigne = !!useLiaison(liaisonInitiale)?.enLigne;

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/livres', { cache: 'no-store' });
      setLivres(await r.json());
    } catch {}
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const enCours = !!livres?.some((l) => l.tache?.etat === 'en cours');

  useEffect(() => {
    if (!enCours) return;
    const t = setInterval(charger, 1000);
    return () => clearInterval(t);
  }, [enCours, charger]);

  async function envoyer(id, method) {
    const r = await fetch(`/api/livres/${id}`, { method });
    if (!r.ok) alert((await r.json()).erreur);
    charger();
  }

  async function desinstaller(l) {
    const r = await supprimer(suppressionLivre(l));
    if (r && !r.ok) alert(r.erreur);
    if (r) charger();
  }

  if (!livres) return <p>Chargement du catalogue</p>;
  if (!livres.length) return <p className="vide">Aucun livre n'est disponible pour l'instant.</p>;

  return (
    <>
      {!enLigne && <p className="hors-liaison">{HORS_LIAISON}. Les livres installés restent lisibles.</p>}
      {livres.map((l) => {
        const t = l.tache;
        const pct = t?.total ? Math.min(100, Math.floor((t.recu / t.total) * 100)) : 0;
        let action;

        if (t?.etat === 'en cours') {
          action = (
            <div className="progression">
              <div className="jauge"><div style={{ width: pct + '%' }} /></div>
              <em>
                {t.extraction
                  ? 'Extraction du texte'
                  : t.verification
                  ? 'Vérification de l\'empreinte'
                  : `${t.source === 'miroir' ? 'Miroir · ' : ''}${pct} % · ${octets(t.recu)} / ${octets(t.total)}`}
              </em>
              <button onClick={() => confirm('Annuler le téléchargement ? La partie déjà reçue sera supprimée.') && envoyer(l.id, 'DELETE')}>Annuler</button>
            </div>
          );
        } else if (l.installe) {
          action = (
            <span>
              <em className="livre-verifie" title={l.fiche?.verifie?.sha256}>
                Installé · vérifié{l.fiche?.verifie?.source === 'miroir' ? ' (miroir)' : ''}
              </em>
              <a href={`/livres/${l.id}`} className="bouton bouton-lire">Lire</a>
              <button onClick={() => desinstaller(l)}>Désinstaller</button>
            </span>
          );
        } else {
          action = (
            <span>
              {t?.etat === 'erreur' && <em className="erreur">{t.erreur}</em>}
              <button disabled={!enLigne} title={enLigne ? undefined : HORS_LIAISON} onClick={() => envoyer(l.id, 'POST')}>
                {t?.etat === 'erreur' ? 'Réessayer' : 'Installer'}
              </button>
              {!enLigne && <em className="hors-liaison">{HORS_LIAISON}</em>}
            </span>
          );
        }

        return (
          <div key={l.id} className="carte pack livre">
            <div>
              <span className="livre-badges">
                <span className="badge">Livre · PDF</span>
                {CATEGORIES[l.categorie] && <span className="badge badge-discret">{CATEGORIES[l.categorie]}</span>}
              </span>
              <strong>{l.titre}</strong>
              <em>{auteurs(l.auteurs)} · {l.editeur}{l.annee ? ` · ${l.annee}` : ''}</em>
              <em>{l.pages ? `${l.pages} pages · ` : ''}{octets(l.taille)} · {l.licence.nom}</em>
              {l.horsCatalogue && <em>Retiré du catalogue</em>}
            </div>
            {action}
          </div>
        );
      })}
    </>
  );
}

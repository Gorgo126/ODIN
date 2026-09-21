import { rechercher, PAR_PAGE } from '../../lib/recherche.mjs';
import BarreRecherche from '../BarreRecherche';

export const dynamic = 'force-dynamic';

export default async function Recherche({ searchParams }) {
  const { q = '', debut = '0' } = await searchParams;
  const requete = q.trim();
  const start = Math.max(0, parseInt(debut, 10) || 0);

  let res = null;
  let erreur = null;
  if (requete) {
    try { res = await rechercher(requete, start); } catch (e) { erreur = e.message; }
  }

  const page = (d) => `/recherche?q=${encodeURIComponent(requete)}&debut=${d}`;

  return (
    <main>
      <h1><a href="/" className="retour-accueil">ODIN</a></h1>
      <BarreRecherche valeur={requete} />

      {erreur && <p className="erreur">{erreur}</p>}

      {res && (
        <>
          <p className="compte">
            {res.total === 0
              ? 'Aucun résultat.'
              : `${res.total.toLocaleString('fr-BE')} résultat${res.total > 1 ? 's' : ''}`}
          </p>

          {res.resultats.map((r) => (
            <a key={r.lien} href={r.lien.replace("/kiwix/content/", "/lire/")} className="carte resultat">
              <strong>{r.titre}</strong>
              <em>{r.livre}</em>
              <p dangerouslySetInnerHTML={{ __html: r.extrait }} />
            </a>
          ))}

          <nav className="pagination">
            <span>{start > 0 && <a href={page(Math.max(0, start - PAR_PAGE))}> Précédents</a>}</span>
            <span>{start + PAR_PAGE < res.total && <a href={page(start + PAR_PAGE)}>Suivants </a>}</span>
          </nav>
        </>
      )}
    </main>
  );
}

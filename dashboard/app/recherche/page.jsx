import { rechercher, PAR_PAGE } from '../../lib/recherche.mjs';
import { chercherDansLivres } from '../../lib/recherche-livres.mjs';
import ZoneRecherche from './ZoneRecherche';

export const dynamic = 'force-dynamic';

// Book pages shown above the encyclopedia articles; all of them with « dans=livres »
const APERCU_LIVRES = 5;
const nombre = (n) => n.toLocaleString('fr-BE');

function ResultatLivre({ r, requete }) {
  return (
    <a href={`/livres/${r.id}?page=${r.page}&q=${encodeURIComponent(requete)}`} className="carte resultat resultat-livre">
      <span className="livre-badges"><span className="badge">Livre</span></span>
      <strong>{r.titre}  p. {r.page}{r.chapitre ? `  ${r.chapitre}` : ''}</strong>
      <p dangerouslySetInnerHTML={{ __html: r.extrait }} />
      {r.sante && <em className="verifier-livre">Vérifiez dans le livre</em>}
    </a>
  );
}

export default async function Recherche({ searchParams }) {
  const { q = '', debut = '0', dans = '', debug = '' } = await searchParams;
  const requete = String(q).trim();
  const start = Math.max(0, parseInt(debut, 10) || 0);
  const seulementLivres = dans === 'livres';

  let zim = null;
  let erreur = null;
  let livres = null;
  if (requete) {
    // Independent: a library without any ZIM (Kiwix error) must not hide the books
    [zim, livres] = await Promise.all([
      seulementLivres ? null : rechercher(requete, start).catch((e) => { erreur = e.message; return null; }),
      chercherDansLivres(requete, seulementLivres ? start : 0, seulementLivres ? PAR_PAGE : APERCU_LIVRES)
        .catch((e) => { console.error(`Recherche dans les livres : ${e.message}`); return null; })
    ]);
  }

  const page = (d, livresSeuls = seulementLivres) =>
    `/recherche?q=${encodeURIComponent(requete)}${livresSeuls ? '&dans=livres' : ''}&debut=${d}`;
  const aucunLivre = !livres?.total;
  // Advanced search on the first page only; the keyword results follow, as before
  const avancee = requete && start === 0 && !seulementLivres;

  return (
    <main>
      <h1><a href="/" className="retour-accueil">ODIN</a></h1>
      <ZoneRecherche valeur={requete} avancee={!!avancee} debug={debug === '1'}>
        {avancee && <h2 className="titre-mots">Tous les résultats par mots-clés</h2>}

        {requete && livres && livres.total > 0 && (
          <section className="bloc-resultats">
            <h2>Dans les livres  {nombre(livres.total)} page{livres.total > 1 ? 's' : ''}</h2>
            {livres.resultats.map((r) => <ResultatLivre key={`${r.id}-${r.page}`} r={r} requete={requete} />)}
            {seulementLivres ? (
              <nav className="pagination">
                <span>{start > 0 && <a href={page(Math.max(0, start - PAR_PAGE))}>Précédentes</a>}</span>
                <span>{start + PAR_PAGE < livres.total && <a href={page(start + PAR_PAGE)}>Suivantes</a>}</span>
              </nav>
            ) : livres.total > APERCU_LIVRES && (
              <p className="tout-voir"><a href={page(0, true)}>Voir les {nombre(livres.total)} pages trouvées dans les livres</a></p>
            )}
          </section>
        )}

        {seulementLivres && <p className="tout-voir"><a href={page(0, false)}>Revenir à tous les résultats</a></p>}

        {!seulementLivres && requete && (
          <section className="bloc-resultats">
            {!aucunLivre && <h2>Dans les encyclopédies{zim ? `  ${nombre(zim.total)} article${zim.total > 1 ? 's' : ''}` : ''}</h2>}
            {erreur && <p className="erreur">{erreur}</p>}
            {zim && (
              <>
                {aucunLivre && (
                  <p className="compte">
                    {zim.total === 0 ? 'Aucun résultat.' : `${nombre(zim.total)} résultat${zim.total > 1 ? 's' : ''}`}
                  </p>
                )}
                {!aucunLivre && zim.total === 0 && <p className="compte">Aucun article.</p>}
                {zim.resultats.map((r) => (
                  <a key={r.lien} href={r.lien.replace('/kiwix/content/', '/lire/')} className="carte resultat">
                    {!aucunLivre && <span className="livre-badges"><span className="badge badge-discret">Article</span></span>}
                    <strong>{r.titre}</strong>
                    <em>{r.livre}</em>
                    <p dangerouslySetInnerHTML={{ __html: r.extrait }} />
                  </a>
                ))}
                <nav className="pagination">
                  <span>{start > 0 && <a href={page(Math.max(0, start - PAR_PAGE))}>Précédents</a>}</span>
                  <span>{start + PAR_PAGE < zim.total && <a href={page(start + PAR_PAGE)}>Suivants</a>}</span>
                </nav>
              </>
            )}
          </section>
        )}
      </ZoneRecherche>
    </main>
  );
}

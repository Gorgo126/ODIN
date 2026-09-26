import { notFound } from 'next/navigation';
import { lireIndex, lienArticle } from '../../../lib/guides-index.mjs';
import Entete from '../Entete';

export const dynamic = 'force-dynamic';

const dateFr =(j) => (j ? j.slice(0, 10).split('-').reverse().join('/') : '');

export default async function Categorie({ params }) {
  const { categorie } = await params;
  const index = await lireIndex();
  const c = index?.categories.find((x) => x.slug === categorie);
  if (!c) notFound();
  // Most recently updated first
  const articles = index.articles
    .filter((a) => a.category === c.slug)
    .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title, 'fr'));

  return (
    <main>
      <Entete />
      <p className="guides-fil"><a href="/comment-faire">Comment faire ?</a>  {c.title}</p>
      <h1 className="titre-page">{c.title}</h1>
      <p className="guides-intro">{c.description}</p>
      {articles.length === 0 && <p className="vide">Aucun article dans cette catégorie.</p>}
      {articles.map((a) => (
        <a key={a.slug} href={lienArticle(a)} className="carte resultat guides-article">
          <strong>{a.title}</strong>
          <em>{a.updated !== a.published ? `Mis à jour le ${dateFr(a.updated)}` : `Publié le ${dateFr(a.published)}`}</em>
          <p>{a.summary}</p>
        </a>
      ))}
    </main>
  );
}

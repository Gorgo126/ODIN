import { notFound, redirect } from 'next/navigation';
import { lireIndex, lienArticle } from '../../../../lib/guides-index.mjs';
import { echapper } from '../../../../lib/guides-html.mjs';
import { liaison } from '../../../../lib/liaison.mjs';
import Lecteur from '../../../lire/[livre]/[[...chemin]]/Lecteur';

export const dynamic = 'force-dynamic';

const dateFr = (j) => j.slice(0, 10).split('-').reverse().join('/');

export default async function Article({ params }) {
  const { categorie, article } = await params;
  const [index, etatLiaison] = await Promise.all([lireIndex(), liaison()]);
  const a = index?.articles.find((x) => x.slug === article);
  if (!a) notFound();
  // An article moved to another category: its old address still leads to it
  if (a.category !== categorie) redirect(lienArticle(a));
  const c = index.categories.find((x) => x.slug === a.category);

  // The fragment has no h1: the title comes from the manifest (contract)
  const html = `<h1>${echapper(a.title)}</h1>`
    + `<p class="guide-date">Publié le ${dateFr(a.published)}${a.updated !== a.published ? `, mis à jour le ${dateFr(a.updated)}` : ''}  odin-node.com</p>`
    + a.html;

  return (
    <Lecteur
      livre={c?.title || 'Comment faire ?'}
      livreLien={`/comment-faire/${a.category}`}
      titre={a.title}
      html={html}
      liaisonInitiale={etatLiaison}
      classe="guide"
    />
  );
}

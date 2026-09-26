import { lireIndex } from '../../lib/guides-index.mjs';
import { etatGuides } from '../../lib/guides.mjs';
import { liaison } from '../../lib/liaison.mjs';
import Entete from './Entete';
import Gestion from './Gestion';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Comment faire ? — ODIN' };

export default async function CommentFaire() {
  const [index, etat, etatLiaison] = await Promise.all([lireIndex(), etatGuides(), liaison()]);
  const nombre = (slug) => index.articles.filter((a) => a.category === slug).length;

  return (
    <main>
      <Entete />
      <h1 className="titre-page">Comment faire ?</h1>
      <p className="guides-intro">Des fiches pratiques pour tenir sans réseau : eau, abri, feu, soins, énergie…</p>

      {index && (
        <div className="guides-categories">
          {index.categories.map((c) => {
            const n = nombre(c.slug);
            const corps = (
              <>
                <strong>{c.title}</strong>
                <p>{c.description}</p>
                <em>{n ? `${n} article${n > 1 ? 's' : ''}` : 'Aucun article pour l\'instant'}</em>
              </>
            );
            return n
              ? <a key={c.slug} href={`/comment-faire/${c.slug}`} className="carte guides-categorie">{corps}</a>
              : <div key={c.slug} className="carte guides-categorie guides-vide">{corps}</div>;
          })}
        </div>
      )}

      <section>
        <h2>Articles</h2>
        <Gestion initial={etat} liaisonInitiale={etatLiaison} />
      </section>
    </main>
  );
}

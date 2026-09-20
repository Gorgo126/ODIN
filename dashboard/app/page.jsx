import { etatServices, espaceDisque, contenu, octets } from '../lib/etat.mjs';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [services, disque, livres] = await Promise.all([
    etatServices(), espaceDisque(), contenu()
  ]);

  const pct = disque ? Math.round((disque.utilise / disque.total) * 100) : 0;

  return (
    <main>
      <h1>ODIN</h1>

      <section>
        <h2>Services</h2>
        {services.map((s) => (
          <a key={s.nom} href={s.lien} className="carte">
            <span className={s.ok ? 'pastille ok' : 'pastille ko'} />
            <strong>{s.nom}</strong>
            <em>{s.ok ? 'en ligne' : 'arrêté'}</em>
          </a>
        ))}
      </section>

      <section>
        <h2>Stockage</h2>
        {disque ? (
          <>
            <div className="jauge"><div style={{ width: `${pct}%` }} /></div>
            <p>{octets(disque.utilise)} utilisés sur {octets(disque.total)} — {octets(disque.libre)} libres</p>
          </>
        ) : <p>Indisponible</p>}
      </section>

      <section>
        <h2>Contenu installé ({livres.length})</h2>
        {livres.length === 0 && <p>Aucun contenu.</p>}
        {livres.map((l, i) => (
          <div key={i} className="carte">
            <strong>{l.titre}</strong>
            <p>{l.description}</p>
            <em>{l.articles.toLocaleString('fr-BE')} articles · {octets(l.taille)} · {l.langue}</em>
          </div>
        ))}
      </section>
    </main>
  );
}

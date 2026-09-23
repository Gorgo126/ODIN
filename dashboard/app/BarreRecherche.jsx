export default function BarreRecherche({ valeur = '' }) {
  return (
    <form action="/recherche" method="get" className="recherche">
      <input type="search" name="q" defaultValue={valeur} placeholder="Une question, des mots-clés…" />
      <button>Rechercher</button>
    </form>
  );
}

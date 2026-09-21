export default function BarreRecherche({ valeur = '' }) {
  return (
    <form action="/recherche" method="get" className="recherche">
      <input type="search" name="q" defaultValue={valeur} placeholder="Rechercher dans la bibliothèque" />
      <button>Rechercher</button>
    </form>
  );
}

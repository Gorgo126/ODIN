// Called once when the Next.js server starts: the internet probe runs even without any visitor
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { demarrerSonde } = await import('./lib/liaison.mjs');
    demarrerSonde();
    // Books installed without their text (older version, failed extraction): made searchable
    const { rattraperTextes } = await import('./lib/livres.mjs');
    rattraperTextes().catch((e) => console.error(`Extraction des textes : ${e.message}`));
    // Document assistant: its worker thread indexes data/documents from startup
    const { demarrerAssistant } = await import('./lib/assistant.mjs');
    demarrerAssistant();
    // Translation packs: nothing left by an installation interrupted by a restart
    const { nettoyerTraduction } = await import('./lib/traduction-packs.mjs');
    nettoyerTraduction().catch((e) => console.error(`Traduction, nettoyage : ${e.message}`));
  }
}

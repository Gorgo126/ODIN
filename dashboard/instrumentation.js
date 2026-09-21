// Called once when the Next.js server starts: the internet probe runs even without any visitor
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { demarrerSonde } = await import('./lib/liaison.mjs');
    demarrerSonde();
  }
}

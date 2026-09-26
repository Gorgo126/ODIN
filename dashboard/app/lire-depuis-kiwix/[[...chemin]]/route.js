// A Kiwix HTML page asked through Caddy (bookmark, typed address, link left in an article) lands here:
// /lire-depuis-kiwix/kiwix/content/<zim>/<article> → /lire/<zim>/<article>. The raw path is kept as
// received, percent-encoding included (an article named « A?B » must not lose its « ? »).
export const dynamic = 'force-dynamic';

export function GET(req) {
  const brut = new URL(req.url).pathname;
  const m = brut.match(/^\/lire-depuis-kiwix\/kiwix\/content\/([^/]+(?:\/.*)?)$/);
  return new Response(null, { status: 302, headers: { Location: m ? `/lire/${m[1]}` : '/encyclopedie' } });
}

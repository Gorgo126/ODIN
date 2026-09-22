import http from 'http';

// GET on kiwix-serve with Node's classic http module rather than fetch: with kiwix-serve's
// « Connection: close », Node 24's fetch (undici) sometimes fails on an internal assertion
// (assert(!this.paused) in Parser.finish) that stops the whole thread. Internal network only;
// `delai` bounds the whole call. Redirects are followed (5 at most).
export function lire(url, delai = 5000, sauts = 5) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && sauts > 0) {
        res.resume();
        clearTimeout(minuterie);
        resolve(lire(new URL(res.headers.location, url).href, delai, sauts - 1));
        return;
      }
      const morceaux = [];
      res.on('data', (m) => morceaux.push(m));
      res.on('end', () => {
        clearTimeout(minuterie);
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statut: res.statusCode, type: res.headers['content-type'] || '', texte: Buffer.concat(morceaux).toString('utf8') });
      });
      res.on('error', (e) => { clearTimeout(minuterie); reject(e); });
    });
    const minuterie = setTimeout(() => req.destroy(new Error(`pas de réponse en ${delai / 1000} s`)), delai);
    req.on('error', (e) => { clearTimeout(minuterie); reject(e); });
  });
}

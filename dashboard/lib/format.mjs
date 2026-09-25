export function octets(n) {
  if (!n) return '';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

// Disk thresholds of all ODIN (home gauge, /sante, status strip): orange above 85 %, red above 95 %
export const niveauDisque = (pct) => (pct > 95 ? 'critique' : pct > 85 ? 'alerte' : '');

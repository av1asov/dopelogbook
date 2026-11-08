/** Accepts both a comma and a dot as the decimal separator. */
export function parseNum(value: unknown): number | null {
  if (value === '' || value == null) return null;
  const n = parseFloat(String(value).replace(',', '.'));
  return isFinite(n) ? n : null;
}

export function fmt(n: number | null | undefined, digits = 1): string {
  return n == null ? '—' : n.toFixed(digits).replace('.', ',');
}

export function fmtSigned(n: number | null | undefined, digits = 1): string {
  if (n == null) return '—';
  return (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), digits);
}

/** 2026-09-14 → 14.09.2026 */
export function rdate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

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

/** A number as it goes into a text field. */
export function numText(n: number | null | undefined): string {
  return n == null ? '' : String(n).replace('.', ',');
}

export function plural(n: number, one: string, few: string, many: string): string {
  const tens = Math.abs(n) % 100;
  const units = tens % 10;
  if (tens > 10 && tens < 20) return many;
  if (units === 1) return one;
  return units >= 2 && units <= 4 ? few : many;
}

/** 2026-09-14 → 14.09 */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

/** 2026-09-14 → 14.09.2026 */
export function rdate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Today's local date, as stored in a session. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

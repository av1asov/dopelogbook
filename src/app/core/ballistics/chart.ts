/** Round axis ticks covering lo..hi. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const top = hi > lo ? hi : lo + 1;
  const raw = (top - lo) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const end = Math.ceil(top / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= end + step * 1e-6; v += step) {
    ticks.push(+v.toFixed(10));
  }
  return ticks;
}

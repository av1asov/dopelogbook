export interface ElementCheck {
  /** Side or diameter on the rectified plane, mm. */
  size: number;
  /** The worst departure of a corner from 90°, degrees. Squares only. */
  angleError?: number;
  /** The size the template gives, mm. */
  expected?: number;
}

export interface QualityLimits {
  tilt: number;
  pxPerMm: number;
  size: number;
  angle: number;
}

export const MEASURE_LIMITS: QualityLimits = { tilt: 40, pxPerMm: 3, size: 0.03, angle: 2 };
export const TEMPLATE_LIMITS: QualityLimits = { tilt: 30, pxPerMm: 4, size: 0.02, angle: 2 };

export type QualityIssue = 'tilt' | 'elements' | 'bent' | 'print-scale' | 'resolution';

export interface Quality {
  tilt: number;
  pxPerMm: number;
  issues: QualityIssue[];
  /** Printed size against the template, when it is off. */
  printScale?: number;
}

const ISSUE_TEXT: Record<Exclude<QualityIssue, 'print-scale'>, string> = {
  tilt: 'Снимите ровнее: дальний край теряет точность',
  elements: 'Не нашёл опорные элементы — выберите тип элемента или отметьте центр одной мишени',
  bent: 'Лист изогнут, прижмите к ровной поверхности',
  resolution: 'Подойдите ближе',
};

export function issueText(issue: QualityIssue, printScale = 1): string {
  if (issue !== 'print-scale') return ISSUE_TEXT[issue];
  const percent = Math.round(printScale * 100);
  return `Мишень напечатана не в 100 % (≈ ${percent} %). Печатайте «Реальный размер»; масштаб взят по элементам мишени`;
}

const PRINT_SCALE_LIMIT = 0.02;

/** Printed size against the template, or null if the template gives no sizes to compare. */
export function printScaleOf(elements: readonly ElementCheck[]): number | null {
  const ratios = elements
    .filter((e) => e.expected != null)
    .map((e) => e.size / (e.expected as number))
    .sort((a, b) => a - b);
  return ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
}

export const isOffScale = (scale: number | null): scale is number =>
  scale != null && Math.abs(scale - 1) > PRINT_SCALE_LIMIT;

/** Equal elements must stay equal once rectified; if not, the sheet was not flat. */
function isBent(elements: readonly ElementCheck[], limits: QualityLimits): boolean {
  if (elements.some((e) => (e.angleError ?? 0) > limits.angle)) return true;
  if (elements.length < 2) return false;
  const sizes = elements.map((e) => e.size);
  return Math.max(...sizes) / Math.min(...sizes) - 1 > limits.size;
}

export function assessQuality(
  tilt: number,
  pxPerMm: number,
  elements: readonly ElementCheck[],
  limits: QualityLimits,
  found: { missing?: boolean; printScale?: number | null } = {},
): Quality {
  const issues: QualityIssue[] = [];
  if (tilt > limits.tilt) issues.push('tilt');
  // Comparing elements that were not really found would blame the sheet for the search.
  if (found.missing) issues.push('elements');
  else if (isBent(elements, limits)) issues.push('bent');
  const printScale = found.printScale ?? printScaleOf(elements);
  if (isOffScale(printScale)) issues.push('print-scale');
  if (pxPerMm < limits.pxPerMm) issues.push('resolution');
  return { tilt, pxPerMm, issues, ...(isOffScale(printScale) ? { printScale } : {}) };
}

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

export type QualityIssue = 'tilt' | 'bent' | 'resolution';

export interface Quality {
  tilt: number;
  pxPerMm: number;
  issues: QualityIssue[];
}

export const ISSUE_TEXT: Record<QualityIssue, string> = {
  tilt: 'Снимите ровнее: дальний край теряет точность',
  bent: 'Лист изогнут, прижмите к ровной поверхности',
  resolution: 'Подойдите ближе',
};

/** Equal elements must stay equal once rectified; if not, the sheet was not flat. */
function isBent(elements: readonly ElementCheck[], limits: QualityLimits): boolean {
  if (elements.some((e) => (e.angleError ?? 0) > limits.angle)) return true;
  if (elements.length > 1) {
    const sizes = elements.map((e) => e.size);
    return Math.max(...sizes) / Math.min(...sizes) - 1 > limits.size;
  }
  return elements.some(
    (e) => e.expected != null && Math.abs(e.size - e.expected) / e.expected > limits.size,
  );
}

export function assessQuality(
  tilt: number,
  pxPerMm: number,
  elements: readonly ElementCheck[],
  limits: QualityLimits,
): Quality {
  const issues: QualityIssue[] = [];
  if (tilt > limits.tilt) issues.push('tilt');
  if (isBent(elements, limits)) issues.push('bent');
  if (pxPerMm < limits.pxPerMm) issues.push('resolution');
  return { tilt, pxPerMm, issues };
}

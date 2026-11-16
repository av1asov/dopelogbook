import { PhotoMarks, Point } from '../../core/ballistics';
import { applyHomography, invertHomography } from '../../core/target/homography';
import { TargetOverlay, toMillimetres } from '../../core/target/measure';
import { SeriesSummary } from './share-text';

/** 4:5 — messengers show it whole, without cropping. */
export const SHARE_WIDTH = 1080;
export const SHARE_HEIGHT = 1350;
export const PHOTO_HEIGHT = 1000;

const FONTS = [
  '800 40px Tektur',
  '600 40px "IBM Plex Sans Condensed"',
  '400 40px "IBM Plex Sans Condensed"',
  '700 40px "JetBrains Mono"',
];
const SAMPLE = 'Яя09≈↑→';

/** The same colours as on the photo screen: the picture looks like the app. */
const COLOURS = {
  plate: '#1d221f',
  text: '#f5f6f2',
  muted: '#b9c2bb',
  mark: '#f1c40f',
  paper: '#ece7d9',
  hole: '#6cc185',
  cold: '#8fb0e8',
  centre: '#e8743b',
  group: '#5aa0ff',
} as const;

export interface ShareShot {
  photo: Blob;
  marks?: PhotoMarks;
  /** This series' target on the photo; on a sheet, one of several. */
  target?: TargetOverlay | null;
  /** Bullet diameter: holes are ringed at this size. */
  holeMm?: number;
  /** The printed target from its template: the picture is cut to it. */
  printed?: PrintedTarget | null;
}

export interface PrintedTarget {
  /** Across its outer element, mm. */
  size: number;
  /** Point of aim from the centre, mm, up and right positive. */
  aim?: { up: number; right: number } | null;
}

/** The part of the target plane on the picture, mm, and its scale. */
interface Frame {
  x0: number;
  y0: number;
  /** Picture pixels per mm. */
  k: number;
  toPlane: (p: Point) => Point;
  toImage: (p: Point) => Point;
}

/** Around a target of unknown size: the target, not just the group, should show. */
const UNKNOWN_TARGET_MM = 200;
/** Paper around the printed target. */
const TARGET_MARGIN = 1.2;
/** Room beyond the farthest hole for its ring, mm. */
const HOLE_ROOM_MM = 12;

/**
 * The whole target: centred on the printed target and cut to its size, from the template.
 * The holes and the point of aim always fit, and without a template it is 200 mm at least.
 */
export function frameOf(
  marks: PhotoMarks,
  target: TargetOverlay,
  printed?: PrintedTarget | null,
): Frame | null {
  const toPlane = toMillimetres(marks);
  const points = [...target.holes, target.aim, target.centre]
    .filter((p): p is Point => !!p)
    .map(toPlane);
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const aim = target.aim && toPlane(target.aim);
  // The aim sits off the centre of some printed targets; plane y grows downwards.
  const { x: cx, y: cy } =
    printed && aim
      ? { x: aim.x - (printed.aim?.right ?? 0), y: aim.y + (printed.aim?.up ?? 0) }
      : {
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          y: (Math.min(...ys) + Math.max(...ys)) / 2,
        };
  const half = ((printed?.size ?? UNKNOWN_TARGET_MM) * TARGET_MARGIN) / 2;
  const halfX = Math.max(half, ...xs.map((x) => Math.abs(x - cx) + HOLE_ROOM_MM));
  const halfY = Math.max(half, ...ys.map((y) => Math.abs(y - cy) + HOLE_ROOM_MM));
  const width = Math.max(halfX * 2, (halfY * 2 * SHARE_WIDTH) / PHOTO_HEIGHT);
  const height = (width * PHOTO_HEIGHT) / SHARE_WIDTH;
  let toImage: (p: Point) => Point;
  if (marks.homography) {
    const inverse = invertHomography(marks.homography);
    toImage = (p) => applyHomography(inverse, p);
  } else {
    const { p1, p2, mm } = marks.scale;
    const pxPerMm = Math.hypot(p2.x - p1.x, p2.y - p1.y) / mm;
    toImage = ({ x, y }) => ({ x: x * pxPerMm, y: y * pxPerMm });
  }
  return { x0: cx - width / 2, y0: cy - height / 2, k: SHARE_WIDTH / width, toPlane, toImage };
}

async function pixelsOf(photo: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(photo);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const g = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = g.getImageData(0, 0, canvas.width, canvas.height);
  release(canvas);
  return pixels;
}

/** iOS counts canvas memory until a canvas is collected; an empty one gives it back at once. */
export function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** The photo straightened onto the target plane: every picture pixel is looked up backwards. */
function drawStraight(g: CanvasRenderingContext2D, source: ImageData, frame: Frame): void {
  const out = g.createImageData(SHARE_WIDTH, PHOTO_HEIGHT);
  const { width: sw, height: sh, data: src } = source;
  const dst = out.data;
  const [pr, pg, pb] = [1, 3, 5].map((i) => parseInt(COLOURS.paper.slice(i, i + 2), 16));
  for (let v = 0; v < PHOTO_HEIGHT; v++) {
    for (let u = 0; u < SHARE_WIDTH; u++) {
      const { x, y } = frame.toImage({
        x: frame.x0 + (u + 0.5) / frame.k,
        y: frame.y0 + (v + 0.5) / frame.k,
      });
      const o = (v * SHARE_WIDTH + u) * 4;
      const fx = x - 0.5;
      const fy = y - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      if (ix < 0 || iy < 0 || ix >= sw - 1 || iy >= sh - 1) {
        dst[o] = pr;
        dst[o + 1] = pg;
        dst[o + 2] = pb;
        dst[o + 3] = 255;
        continue;
      }
      const ax = fx - ix;
      const ay = fy - iy;
      const i00 = (iy * sw + ix) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * ax;
        const bottom = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * ax;
        dst[o + c] = top + (bottom - top) * ay;
      }
      dst[o + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
}

/** A photo without marks: all of it, on paper where it is narrower than the frame. */
async function drawWhole(g: CanvasRenderingContext2D, photo: Blob): Promise<void> {
  const bitmap = await createImageBitmap(photo);
  const scale = Math.min(SHARE_WIDTH / bitmap.width, PHOTO_HEIGHT / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  g.drawImage(bitmap, (SHARE_WIDTH - w) / 2, (PHOTO_HEIGHT - h) / 2, w, h);
  bitmap.close();
}

/** Holes, point of aim, group centre and spread, as on screen 15г. */
function drawMarks(g: CanvasRenderingContext2D, frame: Frame, shot: ShareShot): void {
  const target = shot.target as TargetOverlay;
  const at = (p: Point): Point => {
    const mm = frame.toPlane(p);
    return { x: (mm.x - frame.x0) * frame.k, y: (mm.y - frame.y0) * frame.k };
  };
  g.lineCap = 'round';
  const ring = Math.max(12, ((shot.holeMm ?? 7.6) / 2) * frame.k + 4);
  for (const hole of target.holes) {
    const p = at(hole);
    g.strokeStyle = hole.cold ? COLOURS.cold : COLOURS.hole;
    g.lineWidth = 5;
    g.setLineDash(hole.cold ? [10, 8] : []);
    g.beginPath();
    g.arc(p.x, p.y, ring, 0, Math.PI * 2);
    g.stroke();
  }
  g.setLineDash([]);
  if (target.pair && target.group != null) {
    const [a, b] = target.pair.map(at);
    g.strokeStyle = COLOURS.group;
    g.lineWidth = 4;
    g.setLineDash([16, 12]);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    g.setLineDash([]);
    label(
      g,
      `${Math.round(target.group)} мм`,
      (a.x + b.x) / 2,
      (a.y + b.y) / 2 - 40,
      COLOURS.group,
    );
  }
  const aim = target.aim && at(target.aim);
  const centre = target.centre && at(target.centre);
  if (aim && centre) {
    g.strokeStyle = COLOURS.centre;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(aim.x, aim.y);
    g.lineTo(centre.x, centre.y);
    g.stroke();
  }
  if (aim) {
    g.strokeStyle = COLOURS.mark;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(aim.x - 34, aim.y);
    g.lineTo(aim.x + 34, aim.y);
    g.moveTo(aim.x, aim.y - 34);
    g.lineTo(aim.x, aim.y + 34);
    g.stroke();
  }
  if (centre) {
    g.strokeStyle = COLOURS.centre;
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(centre.x - 16, centre.y - 16);
    g.lineTo(centre.x + 16, centre.y + 16);
    g.moveTo(centre.x + 16, centre.y - 16);
    g.lineTo(centre.x - 16, centre.y + 16);
    g.stroke();
  }
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string) {
  g.font = '700 34px "JetBrains Mono", monospace';
  const w = g.measureText(text).width + 24;
  const cx = Math.min(SHARE_WIDTH - w / 2 - 8, Math.max(w / 2 + 8, x));
  const cy = Math.min(PHOTO_HEIGHT - 30, Math.max(30, y));
  g.fillStyle = COLOURS.plate;
  g.beginPath();
  g.roundRect(cx - w / 2, cy - 26, w, 52, 6);
  g.fill();
  g.fillStyle = colour;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, cx, cy + 2);
}

/** Cuts a line to the width with an ellipsis. */
function fit(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && g.measureText(cut + '…').width > width) cut = cut.slice(0, -1);
  return cut + '…';
}

/** The dark plate under the photo, or the whole picture when there is no photo. */
function drawPlate(g: CanvasRenderingContext2D, summary: SeriesSummary, top: number): void {
  const pad = 56;
  const width = SHARE_WIDTH - pad * 2;
  const big = top === 0;
  const scale = big ? 1.6 : 1;
  g.fillStyle = COLOURS.plate;
  g.fillRect(0, top, SHARE_WIDTH, SHARE_HEIGHT - top);
  g.textBaseline = 'alphabetic';

  const lines: { text: string; font: string; colour: string; gap: number }[] = [
    {
      text: summary.title,
      font: `600 ${Math.round(44 * scale)}px "IBM Plex Sans Condensed", sans-serif`,
      colour: COLOURS.text,
      gap: 44 * scale,
    },
  ];
  const result = summary.group || summary.offset;
  if (result) {
    lines.push({
      text: result,
      font: `700 ${Math.round(84 * scale)}px "JetBrains Mono", monospace`,
      colour: COLOURS.mark,
      gap: 84 * scale,
    });
  }
  const second = [summary.group ? summary.offset : '', summary.stance].filter(Boolean).join(' · ');
  for (const [text, strong] of [
    [second, true],
    [summary.combo, false],
    [summary.conditions, false],
  ] as const) {
    if (!text) continue;
    lines.push({
      text,
      font: `${strong ? 600 : 400} ${Math.round(34 * scale)}px "IBM Plex Sans Condensed", sans-serif`,
      colour: COLOURS.muted,
      gap: 34 * scale,
    });
  }
  const spacing = 14 * scale;
  const total = lines.reduce((sum, l) => sum + l.gap, 0) + spacing * (lines.length - 1);
  let y = top + (SHARE_HEIGHT - top - total) / 2;
  lines.forEach((line, i) => {
    y += line.gap;
    g.font = line.font;
    g.fillStyle = line.colour;
    g.textAlign = 'left';
    const room = i === 0 ? width - 170 * scale : width;
    g.fillText(fit(g, line.text, room), pad, y);
    if (i === 0) {
      g.font = `800 ${Math.round(40 * scale)}px Tektur, sans-serif`;
      g.fillStyle = COLOURS.mark;
      g.textAlign = 'right';
      g.fillText('DOPE', SHARE_WIDTH - pad, y);
    }
    y += spacing;
  });
}

async function loadFonts(): Promise<void> {
  try {
    await Promise.all(FONTS.map((font) => document.fonts.load(font, SAMPLE)));
  } catch {
    /* whatever fonts there are will do */
  }
}

/**
 * The photo part of the picture: straightened and cut to the target, with its marks on top.
 * It does not depend on the plate, so a switch of the text keeps it.
 */
export async function renderPhotoLayer(
  shot: ShareShot,
  withMarks: boolean,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_WIDTH;
  canvas.height = PHOTO_HEIGHT;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = COLOURS.paper;
  g.fillRect(0, 0, SHARE_WIDTH, PHOTO_HEIGHT);
  const frame = shot.marks && shot.target ? frameOf(shot.marks, shot.target, shot.printed) : null;
  if (frame) {
    drawStraight(g, await pixelsOf(shot.photo), frame);
    if (withMarks) {
      await loadFonts();
      drawMarks(g, frame, shot);
    }
  } else {
    await drawWhole(g, shot.photo);
  }
  return canvas;
}

/**
 * The picture of a series: the photo layer, when there is one, and the numbers under it.
 * Drawn from data, never a screenshot.
 */
export async function renderShareImage(
  photo: CanvasImageSource | null,
  summary: SeriesSummary,
): Promise<Blob> {
  await loadFonts();
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_WIDTH;
  canvas.height = SHARE_HEIGHT;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;

  if (photo) {
    g.drawImage(photo, 0, 0);
    drawPlate(g, summary, PHOTO_HEIGHT);
  } else {
    drawPlate(g, summary, 0);
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.9),
  );
  release(canvas);
  if (!blob) throw new Error('canvas export failed');
  return blob;
}

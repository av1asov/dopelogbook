import type * as OpenCv from '@techstark/opencv-js';
import { Point } from '../ballistics/model';

type Cv = typeof OpenCv;
type Mat = OpenCv.Mat;

interface Owner {
  own<T extends { delete(): void }>(item: T): T;
}

/** The clean sheet moved onto the shot; `covers` is zero where it says nothing. */
export interface CleanPicture {
  picture: Mat;
  covers: Mat;
}

export interface HoleCandidate extends Point {
  score: number;
}

/** A square of solid print: a dark hole there is only the print itself. */
export interface PrintedZone extends Point {
  half: number;
}

const WINDOW_DIAMETERS = 3;
/** Wide enough to fill in two touching holes, in bullet radii. */
const SHAPE_RADII = 3.4;
/** The largest shape to slide over the picture, in its reduced pixels. */
const MAX_KERNEL = 21;
const MAX_WORKING_RADIUS = 20;
/** Opening that clears away thin lines, in bullet radii. */
const OPEN_RADII = 0.6;
/** Joins the pieces of a core across the threads of the backing. */
const CLOSE_RADII = 0.5;
/** How far the plane alone can leave the two rectified pictures apart, px. */
const MAX_NUDGE = 40;
/** Over how many bullet radii the light of a shot is taken as even. */
const LIGHT_RADII = 16;
/** Print edges can be this many pixels off without counting as a difference. */
const PRINT_TOLERANCE = 2;
/** The paper closes in behind the bullet, so the core is smaller than the calibre. */
const CORE_OF_CALIBRE = 0.9;
const MAX_MERGED = 4;
/** How far from its surroundings a pixel has to be, in the 8-bit units of Lab. */
const MIN_DELTA = 26;
const MIN_ROUNDNESS = 0.6;
const MAX_ELONGATION = 2;
const MIN_SOLIDITY_MERGED = 0.8;
/** Blue ink is far on the blue side of neutral; a hole never is. */
const INK_BLUE = 14;
const RIM_GAP = 6;
const RIM_SAMPLES = 64;
const RIM_DARK_MARGIN = 10;
const RIM_LIGHT_MARGIN = 20;
/** Two levels this far apart inside one dark blob: a core, and something that is not it. */
const CORE_GAP = 30;
const MIN_TONE_SHARE = 0.25;
const MERGED_ELONGATION = 0.6;
/** Several holes together are never this round; a printed emblem is. */
const MAX_MERGED_ROUNDNESS = 0.8;

const odd = (n: number): number => Math.max(3, Math.round(n) | 1);
const ellipse = (cv: Cv, size: number): Mat =>
  cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(size, size));

function toLab(cv: Cv, rgba: Mat, owner: Owner): Mat {
  const rgb = owner.own(new cv.Mat());
  cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
  const lab = owner.own(new cv.Mat());
  cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
  return lab;
}

interface Surroundings {
  /** Lightness with everything darker than the paper around it and hole-sized filled in. */
  filled: Mat;
  /** The same with everything lighter taken away. */
  emptied: Mat;
  /** Median colour, over a few hole widths. */
  colour: Mat;
}

const fullSize = (cv: Cv, small: Mat, like: Mat, owner: Owner): Mat => {
  const full = owner.own(new cv.Mat());
  cv.resize(small, full, new cv.Size(like.cols, like.rows), 0, 0, cv.INTER_LINEAR);
  return full;
};

/**
 * What the paper would be like with no holes. Lightness goes by shape, because a median flips
 * from field to paper near the curved edge of a printed disc and paints the edge as a hole.
 * Small: this is smooth anyway, and a phone has to do it.
 */
function surroundings(cv: Cv, lab: Mat, radius: number, owner: Owner): Surroundings {
  const shrink = Math.min(0.5, MAX_KERNEL / (radius * SHAPE_RADII));
  const small = owner.own(new cv.Mat());
  cv.resize(lab, small, new cv.Size(0, 0), shrink, shrink, cv.INTER_AREA);
  const channels = owner.own(new cv.MatVector());
  cv.split(small, channels);
  const lightness = owner.own(channels.get(0));
  const kernel = owner.own(ellipse(cv, odd(radius * SHAPE_RADII * shrink)));
  const filled = owner.own(new cv.Mat());
  cv.morphologyEx(lightness, filled, cv.MORPH_CLOSE, kernel);
  const emptied = owner.own(new cv.Mat());
  cv.morphologyEx(lightness, emptied, cv.MORPH_OPEN, kernel);
  const size = odd(radius * 2 * WINDOW_DIAMETERS * shrink);
  for (let i = 0; i < 3; i++) {
    const channel = owner.own(channels.get(i));
    cv.medianBlur(channel, channel, size);
  }
  const colour = owner.own(new cv.Mat());
  cv.merge(channels, colour);
  const median = owner.own(channels.get(0));
  // Each estimate fails in its own place: the median by curved edges, the shapes in narrow cells.
  // Opening also darkens the paper around a dark hole, which the median does not.
  cv.min(filled, median, filled);
  cv.max(emptied, median, emptied);
  return {
    filled: fullSize(cv, filled, lab, owner),
    emptied: fullSize(cv, emptied, lab, owner),
    colour: fullSize(cv, colour, lab, owner),
  };
}

/** Pixels unlike their surroundings, split by being darker or lighter. */
function deviations(cv: Cv, lab: Mat, around: Surroundings, owner: Owner) {
  const dark = owner.own(cv.Mat.zeros(lab.rows, lab.cols, cv.CV_8UC1));
  const light = owner.own(cv.Mat.zeros(lab.rows, lab.cols, cv.CV_8UC1));
  const a = lab.data as Uint8Array;
  const c = around.colour.data as Uint8Array;
  const [filled, emptied] = [around.filled.data as Uint8Array, around.emptied.data as Uint8Array];
  const [d, l] = [dark.data as Uint8Array, light.data as Uint8Array];
  const limit = MIN_DELTA * MIN_DELTA;
  for (let i = 0, p = 0; i < d.length; i++, p += 3) {
    const darker = Math.max(0, filled[i] - a[p]);
    const lighter = Math.max(0, a[p] - emptied[i]);
    const dA = a[p + 1] - c[p + 1];
    const dB = a[p + 2] - c[p + 2];
    const hue = dA * dA + dB * dB;
    if (Math.max(darker, lighter) ** 2 + hue < limit) continue;
    if (darker >= lighter) d[i] = 255;
    else l[i] = 255;
  }
  return { dark, light };
}

/** Nudges the clean sheet onto the new shot: the two rectified pictures are a few pixels apart. */
function aligned(cv: Cv, clean: Mat, rgba: Mat, owner: Owner): Mat {
  const smallGray = (picture: Mat): Mat => {
    const gray = owner.own(new cv.Mat());
    cv.cvtColor(picture, gray, cv.COLOR_RGBA2GRAY);
    const small = owner.own(new cv.Mat());
    cv.resize(gray, small, new cv.Size(0, 0), 0.5, 0.5, cv.INTER_AREA);
    return small;
  };
  const warp = owner.own(cv.Mat.eye(2, 3, cv.CV_32F));
  try {
    const criteria = new cv.TermCriteria(cv.TermCriteria_COUNT + cv.TermCriteria_EPS, 40, 1e-3);
    const noMask = owner.own(new cv.Mat());
    cv.findTransformECC(
      smallGray(rgba),
      smallGray(clean),
      warp,
      cv.MOTION_AFFINE,
      criteria,
      noMask,
      5,
    );
  } catch {
    // It does not converge on every pair of pictures; the plane alone is still close.
    return clean;
  }
  const values = warp.data32F as Float32Array;
  values[2] *= 2;
  values[5] *= 2;
  if (Math.hypot(values[2], values[5]) > MAX_NUDGE) return clean;
  const moved = owner.own(new cv.Mat());
  cv.warpAffine(
    clean,
    moved,
    warp,
    new cv.Size(rgba.cols, rgba.rows),
    cv.INTER_LINEAR + cv.WARP_INVERSE_MAP,
    cv.BORDER_REPLICATE,
  );
  return moved;
}

/** The clean sheet under the light of the new shot, channel by channel. */
function underSameLight(cv: Cv, clean: Mat, rgba: Mat, radius: number, owner: Owner): Mat {
  const size = new cv.Size(odd(radius * LIGHT_RADII), odd(radius * LIGHT_RADII));
  const localMean = (picture: Mat): Uint8Array => {
    const mean = owner.own(new cv.Mat());
    cv.blur(picture, mean, size);
    return mean.data as Uint8Array;
  };
  const [ofClean, ofShot] = [localMean(clean), localMean(rgba)];
  const lit = owner.own(clean.clone());
  const data = lit.data as Uint8Array;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.min(255, (data[i + c] * (ofShot[i + c] + 1)) / (ofClean[i + c] + 1));
    }
  }
  return lit;
}

/** Pixels unlike the clean sheet: the print cancels out, on any colour, and holes remain. */
function differences(
  cv: Cv,
  rgba: Mat,
  lab: Mat,
  { picture, covers }: CleanPicture,
  radius: number,
  owner: Owner,
) {
  const reference = toLab(
    cv,
    underSameLight(cv, aligned(cv, picture, rgba, owner), rgba, radius, owner),
    owner,
  );
  const known = covers.data as Uint8Array;
  const kernel = owner.own(ellipse(cv, 2 * PRINT_TOLERANCE + 1));
  const high = owner.own(new cv.Mat());
  cv.dilate(reference, high, kernel);
  const low = owner.own(new cv.Mat());
  cv.erode(reference, low, kernel);
  const dark = owner.own(cv.Mat.zeros(lab.rows, lab.cols, cv.CV_8UC1));
  const light = owner.own(cv.Mat.zeros(lab.rows, lab.cols, cv.CV_8UC1));
  const [a, h, l] = [lab.data as Uint8Array, high.data as Uint8Array, low.data as Uint8Array];
  const [d, b] = [dark.data as Uint8Array, light.data as Uint8Array];
  const limit = MIN_DELTA * MIN_DELTA;
  const off = (p: number) => Math.max(0, a[p] - h[p], l[p] - a[p]);
  for (let i = 0, p = 0; i < d.length; i++, p += 3) {
    if (known[i] < 255) continue;
    const [dL, dA, dB] = [off(p), off(p + 1), off(p + 2)];
    if (dL * dL + dA * dA + dB * dB < limit) continue;
    if (a[p] < l[p]) d[i] = 255;
    else b[i] = 255;
  }
  return { dark, light };
}

/** Light threads of the backing inside a dark core, and the other way round, are part of it. */
function solidify(cv: Cv, mask: Mat, radius: number, owner: Owner): void {
  const close = owner.own(ellipse(cv, odd(radius * CLOSE_RADII)));
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, close);
  const contours = owner.own(new cv.MatVector());
  const hierarchy = owner.own(new cv.Mat());
  cv.findContours(mask, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
  const biggest = Math.PI * radius * radius * 0.5;
  const links = hierarchy.data32S as Int32Array;
  for (let i = 0; i < contours.size(); i++) {
    if (links[i * 4 + 3] < 0) continue;
    const gap = owner.own(contours.get(i));
    if (cv.contourArea(gap) < biggest)
      cv.drawContours(mask, contours, i, new cv.Scalar(255), cv.FILLED);
  }
  const open = owner.own(ellipse(cv, odd(radius * OPEN_RADII)));
  cv.morphologyEx(mask, mask, cv.MORPH_OPEN, open);
}

function otsu(levels: readonly number[]): { threshold: number; gap: number } {
  const counts = new Array<number>(256).fill(0);
  for (const level of levels) counts[level]++;
  const total = levels.length;
  const sum = counts.reduce((all, n, level) => all + n * level, 0);
  let [below, sumBelow, best, threshold, gap] = [0, 0, -1, 0, 0];
  for (let level = 0; level < 256; level++) {
    below += counts[level];
    if (!below || below === total) continue;
    sumBelow += counts[level] * level;
    const lower = sumBelow / below;
    const upper = (sum - sumBelow) / (total - below);
    const spread = below * (total - below) * (upper - lower) ** 2;
    if (spread > best) [best, threshold, gap] = [spread, level, upper - lower];
  }
  return { threshold, gap };
}

/**
 * Only the core of each dark blob: the sliver of print a hole has joined, or the mix of strokes
 * and paper that a printed emblem blurs into, is lighter than a core and goes away.
 */
function keepCores(cv: Cv, mask: Mat, lab: Mat, radius: number, owner: Owner): void {
  const contours = owner.own(new cv.MatVector());
  const hierarchy = owner.own(new cv.Mat());
  cv.findContours(mask, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
  const links = hierarchy.data32S as Int32Array;
  const shape = owner.own(cv.Mat.zeros(mask.rows, mask.cols, cv.CV_8UC1));
  const data = lab.data as Uint8Array;
  const on = mask.data as Uint8Array;
  for (let i = 0; i < contours.size(); i++) {
    if (links[i * 4 + 3] >= 0) continue;
    const contour = owner.own(contours.get(i));
    if (cv.contourArea(contour) < Math.PI * radius * radius * 0.25) continue;
    const pixels = blobPixels(cv, contour, shape, owner);
    const { threshold, gap } = otsu(pixels.map(({ x, y }) => data[(y * lab.cols + x) * 3]));
    if (gap < CORE_GAP) continue;
    for (const { x, y } of pixels) {
      if (data[(y * lab.cols + x) * 3] > threshold) on[y * mask.cols + x] = 0;
    }
  }
}

interface Blob {
  pixels: Point[];
  centre: Point;
}

type Tone =
  | { polarity: 'dark' | 'light'; printGone: boolean; mixed?: undefined }
  | { polarity?: undefined; printGone: boolean; mixed: { dark: Mat; light: Mat } };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function blobPixels(cv: Cv, contour: Mat, shape: Mat, owner: Owner): Point[] {
  const box = cv.boundingRect(contour);
  const single = owner.own(new cv.MatVector());
  single.push_back(contour);
  cv.drawContours(shape, single, 0, new cv.Scalar(255), cv.FILLED);
  const data = shape.data as Uint8Array;
  const pixels: Point[] = [];
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const i = y * shape.cols + x;
      if (data[i]) {
        pixels.push({ x, y });
        data[i] = 0;
      }
    }
  }
  return pixels;
}

/** Touching holes: seeds at the widest places of the blob, then each pixel goes to its seed. */
function splitBlob(
  cv: Cv,
  { pixels, centre }: Blob,
  count: number,
  radius: number,
  owner: Owner,
): Point[] {
  const left = Math.min(...pixels.map((p) => p.x)) - 1;
  const top = Math.min(...pixels.map((p) => p.y)) - 1;
  const cols = Math.max(...pixels.map((p) => p.x)) - left + 2;
  const rows = Math.max(...pixels.map((p) => p.y)) - top + 2;
  const shape = owner.own(cv.Mat.zeros(rows, cols, cv.CV_8UC1));
  const on = shape.data as Uint8Array;
  for (const { x, y } of pixels) on[(y - top) * cols + x - left] = 255;
  const distances = owner.own(new cv.Mat());
  cv.distanceTransform(shape, distances, cv.DIST_L2, 5);
  const depth = distances.data32F as Float32Array;
  const ranked = pixels
    .map((p) => ({ ...p, depth: depth[(p.y - top) * cols + p.x - left] }))
    .sort((a, b) => b.depth - a.depth);
  const seeds: Point[] = [];
  for (const p of ranked) {
    if (seeds.every((s) => Math.hypot(s.x - p.x, s.y - p.y) > radius * 0.9)) seeds.push(p);
    if (seeds.length === count) break;
  }
  if (seeds.length < 2) return [centre];
  let centres = seeds;
  for (let round = 0; round < 5; round++) {
    const sums = centres.map(() => ({ x: 0, y: 0, n: 0 }));
    for (const p of pixels) {
      let nearest = 0;
      let closest = Infinity;
      centres.forEach((c, i) => {
        const gap = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
        if (gap < closest) [closest, nearest] = [gap, i];
      });
      sums[nearest].x += p.x;
      sums[nearest].y += p.y;
      sums[nearest].n++;
    }
    centres = sums.map((s, i) => (s.n ? { x: s.x / s.n, y: s.y / s.n } : centres[i]));
  }
  return centres;
}

function isBlueInk(lab: Mat, pixels: readonly Point[]): boolean {
  const data = lab.data as Uint8Array;
  let sum = 0;
  for (const { x, y } of pixels) sum += data[(y * lab.cols + x) * 3 + 2];
  return sum / pixels.length < 128 - INK_BLUE;
}

/** A piece of the print cut off by white lines looks like a hole, but it is no darker than print. */
function isPrint(lab: Mat, pixels: readonly Point[], box: Box, polarity: 'dark' | 'light') {
  const data = lab.data as Uint8Array;
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  const r = Math.max(box.width, box.height) / 2 + RIM_GAP;
  const rim: number[] = [];
  for (let i = 0; i < RIM_SAMPLES; i++) {
    const a = (i / RIM_SAMPLES) * 2 * Math.PI;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r);
    if (x >= 0 && y >= 0 && x < lab.cols && y < lab.rows) rim.push(data[(y * lab.cols + x) * 3]);
  }
  if (!rim.length) return false;
  rim.sort((a, b) => a - b);
  let sum = 0;
  for (const { x, y } of pixels) sum += data[(y * lab.cols + x) * 3];
  const level = sum / pixels.length;
  // A dark piece matches the print beside it. Light rays of torn paper can surround a light
  // hole, so that one only has to stand out from what most of its rim is.
  return polarity === 'dark'
    ? level > rim[Math.floor(rim.length * 0.1)] - RIM_DARK_MARGIN
    : level < rim[Math.floor(rim.length / 2)] + RIM_LIGHT_MARGIN;
}

/** Near the corner of a field the search clips a light hole; the picture itself does not. */
function recentred(lab: Mat, start: Point, radius: number): Point {
  const data = lab.data as Uint8Array;
  const reach = Math.ceil(radius * 1.3);
  const at = (x: number, y: number) => data[(y * lab.cols + x) * 3];
  const [cx, cy] = [Math.round(start.x), Math.round(start.y)];
  if (cx < reach || cy < reach || cx >= lab.cols - reach || cy >= lab.rows - reach) return start;
  const inner: number[] = [];
  const outer: number[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const r = Math.hypot(dx, dy);
      if (r <= radius * 0.4) inner.push(at(cx + dx, cy + dy));
      else if (r >= radius * 1.1 && r <= reach) outer.push(at(cx + dx, cy + dy));
    }
  }
  const middle = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
  const level = (middle(inner) + middle(outer)) / 2;
  let [x, y, n] = [0, 0, 0];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (Math.hypot(dx, dy) <= reach && at(cx + dx, cy + dy) >= level) {
        x += dx;
        y += dy;
        n++;
      }
    }
  }
  return n ? { x: cx + x / n, y: cy + y / n } : start;
}

/** A hole across the edge of a field: part of it shows darker than the paper, part lighter. */
function isTwoToned({ dark, light }: { dark: Mat; light: Mat }, pixels: readonly Point[]): boolean {
  const [d, l] = [dark.data as Uint8Array, light.data as Uint8Array];
  let [darker, lighter] = [0, 0];
  for (const { x, y } of pixels) {
    const i = y * dark.cols + x;
    if (d[i]) darker++;
    else if (l[i]) lighter++;
  }
  return Math.min(darker, lighter) >= pixels.length * MIN_TONE_SHARE;
}

function collect(
  cv: Cv,
  mask: Mat,
  lab: Mat,
  tone: Tone,
  radius: number,
  found: HoleCandidate[],
  owner: Owner,
): void {
  const core = radius * CORE_OF_CALIBRE;
  const expected = Math.PI * core * core;
  const contours = owner.own(new cv.MatVector());
  const hierarchy = owner.own(new cv.Mat());
  // Not just the outermost: a frame around the picture must not hide what is inside it.
  cv.findContours(mask, contours, hierarchy, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
  const links = hierarchy.data32S as Int32Array;
  const shape = owner.own(cv.Mat.zeros(mask.rows, mask.cols, cv.CV_8UC1));
  for (let i = 0; i < contours.size(); i++) {
    if (links[i * 4 + 3] >= 0) continue;
    const contour = owner.own(contours.get(i));
    const area = cv.contourArea(contour);
    const ratio = area / expected;
    if (ratio < 0.5 || ratio > MAX_MERGED * 1.5) continue;
    const box = cv.boundingRect(contour);
    if (box.x <= 1 || box.y <= 1) continue;
    if (box.x + box.width >= mask.cols - 1 || box.y + box.height >= mask.rows - 1) continue;
    const hull = owner.own(new cv.Mat());
    cv.convexHull(contour, hull, false, true);
    const solidity = area / cv.contourArea(hull);
    const perimeter = cv.arcLength(contour, true);
    const roundness = (4 * Math.PI * area) / (perimeter * perimeter);
    const rect = cv.minAreaRect(contour);
    const elongation =
      Math.max(rect.size.width, rect.size.height) /
      Math.max(1, Math.min(rect.size.width, rect.size.height));
    const merged = ratio > 1.5 ? Math.min(MAX_MERGED, Math.round(ratio)) : 1;
    if (merged === 1 && (roundness < MIN_ROUNDNESS || elongation > MAX_ELONGATION)) continue;
    if (
      merged > 1 &&
      (solidity < MIN_SOLIDITY_MERGED ||
        elongation > merged + MERGED_ELONGATION ||
        roundness > MAX_MERGED_ROUNDNESS)
    ) {
      continue;
    }
    const pixels = blobPixels(cv, contour, shape, owner);
    if (isBlueInk(lab, pixels)) continue;
    if (tone.mixed && !tone.printGone && !isTwoToned(tone.mixed, pixels)) continue;
    if (!tone.mixed && !tone.printGone && isPrint(lab, pixels, box, tone.polarity)) continue;
    const m = cv.moments(contour, false);
    let centre = { x: m.m10 / m.m00, y: m.m01 / m.m00 };
    if (tone.polarity === 'light' && merged === 1) centre = recentred(lab, centre, radius);
    if (merged === 1) {
      found.push({ ...centre, score: roundness * (1 - Math.abs(ratio - 1) * 0.5) });
      continue;
    }
    for (const part of splitBlob(cv, { pixels, centre }, merged, core, owner)) {
      found.push({ ...part, score: solidity * 0.7 });
    }
  }
}

/**
 * Holes on a picture in colour, best first, in its pixels. A hole can be lighter or darker than
 * the paper around it, whatever colour that is, so both are always looked for. `radius` is that
 * of the bullet.
 */
export function findHoles(
  cv: Cv,
  rgba: Mat,
  radius: number,
  printed: readonly PrintedZone[],
  owner: Owner,
  clean: CleanPicture | null = null,
): HoleCandidate[] {
  if (radius <= MAX_WORKING_RADIUS) return search(cv, rgba, radius, printed, clean, owner);
  // A close-up has far more pixels on a hole than it takes to find one.
  const shrink = MAX_WORKING_RADIUS / radius;
  const reduced = (picture: Mat): Mat => {
    const small = owner.own(new cv.Mat());
    cv.resize(picture, small, new cv.Size(0, 0), shrink, shrink, cv.INTER_AREA);
    return small;
  };
  const zones = printed.map(({ x, y, half }) => ({
    x: x * shrink,
    y: y * shrink,
    half: half * shrink,
  }));
  return search(
    cv,
    reduced(rgba),
    MAX_WORKING_RADIUS,
    zones,
    clean && { picture: reduced(clean.picture), covers: reduced(clean.covers) },
    owner,
  ).map((hole) => ({ ...hole, x: hole.x / shrink, y: hole.y / shrink }));
}

function search(
  cv: Cv,
  rgba: Mat,
  radius: number,
  printed: readonly PrintedZone[],
  clean: CleanPicture | null,
  owner: Owner,
): HoleCandidate[] {
  const lab = toLab(cv, rgba, owner);
  const { dark, light } = clean
    ? differences(cv, rgba, lab, clean, radius, owner)
    : deviations(cv, lab, surroundings(cv, lab, radius, owner), owner);
  const black = new cv.Scalar(0);
  for (const { x, y, half } of printed) {
    cv.rectangle(
      dark,
      new cv.Point(x - half, y - half),
      new cv.Point(x + half, y + half),
      black,
      cv.FILLED,
    );
  }
  const found: HoleCandidate[] = [];
  const mixed = owner.own(new cv.Mat());
  cv.bitwise_or(dark, light, mixed);
  const tones = { dark: owner.own(dark.clone()), light: owner.own(light.clone()) };
  solidify(cv, mixed, radius, owner);
  collect(cv, mixed, lab, { mixed: tones, printGone: !!clean }, radius, found, owner);
  for (const [mask, polarity] of [
    [dark, 'dark'],
    [light, 'light'],
  ] as const) {
    solidify(cv, mask, radius, owner);
    if (polarity === 'dark') {
      keepCores(cv, mask, lab, radius, owner);
      solidify(cv, mask, radius, owner);
    }
    collect(cv, mask, lab, { polarity, printGone: !!clean }, radius, found, owner);
  }
  const best = [...found].sort((a, b) => b.score - a.score);
  return best.filter(
    (hole, i) =>
      !best
        .slice(0, i)
        .some((other) => Math.hypot(hole.x - other.x, hole.y - other.y) < radius * 0.7),
  );
}

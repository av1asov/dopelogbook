const SOI = 0xffd8;
const APP1 = 0xffe1;
const SOS = 0xffda;
const EXIF_IFD = 0x8769;
const DATE_TIME_ORIGINAL = 0x9003;
const DATE_TIME = 0x0132;
const ASCII = 2;

/**
 * The day a JPEG was taken, «YYYY-MM-DD», from its EXIF: the original date if there is one,
 * else the date the file was written. Null when the file has no such tag or is not a JPEG.
 */
export function exifDate(buffer: ArrayBuffer): string | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== SOI) return null;
  let at = 2;
  while (at + 4 <= view.byteLength) {
    const marker = view.getUint16(at);
    if ((marker & 0xff00) !== 0xff00 || marker === SOS) return null;
    const length = view.getUint16(at + 2);
    if (marker === APP1 && isExif(view, at + 4)) {
      return readTiff(view, at + 10, at + 2 + length);
    }
    at += 2 + length;
  }
  return null;
}

function isExif(view: DataView, at: number): boolean {
  return (
    at + 6 <= view.byteLength && view.getUint32(at) === 0x45786966 && view.getUint16(at + 4) === 0
  );
}

function readTiff(view: DataView, start: number, end: number): string | null {
  if (start + 8 > Math.min(end, view.byteLength)) return null;
  const order = view.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  const limit = Math.min(end, view.byteLength);

  /** Tag entries of the directory at `offset`, as [tag, entry position]. */
  const entries = (offset: number): [number, number][] => {
    const at = start + offset;
    if (at + 2 > limit) return [];
    const count = u16(at);
    const list: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12;
      if (entry + 12 > limit) break;
      list.push([u16(entry), entry]);
    }
    return list;
  };

  const text = (entry: number): string | null => {
    if (u16(entry + 2) !== ASCII) return null;
    const count = u32(entry + 4);
    const at = count > 4 ? start + u32(entry + 8) : entry + 8;
    if (at + count > limit) return null;
    let value = '';
    for (let i = 0; i < count; i++) {
      const code = view.getUint8(at + i);
      if (!code) break;
      value += String.fromCharCode(code);
    }
    return value;
  };

  const ifd0 = entries(u32(start + 4));
  const exif = ifd0.find(([tag]) => tag === EXIF_IFD);
  const original = exif
    ? entries(u32(exif[1] + 8)).find(([tag]) => tag === DATE_TIME_ORIGINAL)
    : undefined;
  const written = ifd0.find(([tag]) => tag === DATE_TIME);
  for (const found of [original, written]) {
    const date = found && toIsoDate(text(found[1]));
    if (date) return date;
  }
  return null;
}

/** «2026:11:05 14:03:11» → «2026-11-05». */
function toIsoDate(value: string | null): string | null {
  const match = value?.match(/^(\d{4}):(\d{2}):(\d{2})/);
  if (!match || match[1] === '0000') return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** The day the photo was taken, if the file says. */
export async function photoTakenOn(file: Blob): Promise<string | null> {
  try {
    // The EXIF block sits at the start of the file and is at most 64 KB.
    return exifDate(await file.slice(0, 128 * 1024).arrayBuffer());
  } catch {
    return null;
  }
}

/** Whole days between two «YYYY-MM-DD» dates. */
export function daysBetween(a: string, b: string): number {
  const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round(Math.abs(day(a) - day(b)) / 86_400_000);
}

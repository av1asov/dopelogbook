import { daysBetween, exifDate } from './exif';

/** A JPEG holding only an EXIF block with the given tags, in either byte order. */
function jpeg(options: { original?: string; written?: string; little?: boolean }): ArrayBuffer {
  const little = options.little ?? false;
  const tiff: number[] = [];
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) => {
    const bytes = [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    return little ? bytes.reverse() : bytes;
  };
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);

  // Layout: header (8) · IFD0 · Exif IFD · strings.
  const ifd0Entries = (options.written ? 1 : 0) + 1;
  const ifd0At = 8;
  const exifAt = ifd0At + 2 + ifd0Entries * 12 + 4;
  const exifEntries = options.original ? 1 : 0;
  const stringsAt = exifAt + 2 + exifEntries * 12 + 4;
  const strings: number[] = [];
  const place = (s: string) => {
    const at = stringsAt + strings.length;
    strings.push(...ascii(s));
    return at;
  };
  const entry = (tag: number, type: number, count: number, value: number) => [
    ...u16(tag),
    ...u16(type),
    ...u32(count),
    ...u32(value),
  ];

  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifd0At));
  tiff.push(...u16(ifd0Entries));
  if (options.written) tiff.push(...entry(0x0132, 2, 20, place(options.written)));
  tiff.push(...entry(0x8769, 4, 1, exifAt), ...u32(0));
  tiff.push(...u16(exifEntries));
  if (options.original) tiff.push(...entry(0x9003, 2, 20, place(options.original)));
  tiff.push(...u32(0), ...strings);

  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = app1.length + 2;
  const bytes = [0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...app1, 0xff, 0xda, 0, 2];
  return new Uint8Array(bytes).buffer;
}

describe('exifDate', () => {
  it('reads the original date', () => {
    expect(exifDate(jpeg({ original: '2026:11:05 14:03:11' }))).toBe('2026-11-05');
  });

  it('reads little-endian files too', () => {
    expect(exifDate(jpeg({ original: '2026:11:05 14:03:11', little: true }))).toBe('2026-11-05');
  });

  it('prefers the original date to the date the file was written', () => {
    const buffer = jpeg({ original: '2026:11:05 10:00:00', written: '2026:11:09 10:00:00' });
    expect(exifDate(buffer)).toBe('2026-11-05');
    expect(exifDate(jpeg({ written: '2026:11:09 10:00:00' }))).toBe('2026-11-09');
  });

  it('gives nothing for a file without a date or not a JPEG', () => {
    expect(exifDate(jpeg({}))).toBeNull();
    expect(exifDate(jpeg({ original: '0000:00:00 00:00:00' }))).toBeNull();
    expect(exifDate(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeNull();
    expect(exifDate(new ArrayBuffer(0))).toBeNull();
  });
});

describe('daysBetween', () => {
  it('counts whole days either way', () => {
    expect(daysBetween('2026-11-05', '2026-11-08')).toBe(3);
    expect(daysBetween('2026-11-08', '2026-11-05')).toBe(3);
    expect(daysBetween('2026-11-08', '2026-11-08')).toBe(0);
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
  });
});

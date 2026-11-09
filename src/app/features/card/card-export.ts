import {
  ammoName,
  CardData,
  devName,
  fmt,
  fmtAng,
  GroupStats,
  GroupUnit,
  rdate,
  restName,
  todayIso,
  unitDigits,
  unitLabel,
  unitShort,
  unitsOf,
} from '../../core/ballistics';

export interface CardExportOptions {
  size: 'wide' | 'strip';
  wind: boolean;
  device: string;
  rest: string;
  group: GroupStats | null;
  groupUnit: GroupUnit;
}

const FONTS = [
  '800 16px Tektur',
  '600 16px "IBM Plex Sans Condensed"',
  '400 16px "IBM Plex Sans Condensed"',
  '400 16px "JetBrains Mono"',
  'italic 400 16px "JetBrains Mono"',
  '500 16px "JetBrains Mono"',
  '700 16px "JetBrains Mono"',
];
const SAMPLE = 'Яя09≈';

/** The scope is named only when the rifle has more than one to tell apart. */
const scopeName = ({ rifle, scope }: CardData): string | undefined =>
  rifle.mounts.length > 1 ? scope?.name : undefined;

const hasWind = (data: CardData, options: CardExportOptions): boolean =>
  options.wind && data.points.wind.length > 0;

function subtitle(data: CardData, options: CardExportOptions): (string | false | undefined)[] {
  const { rifle, combo, ammo } = data;
  return [
    rifle.caliber,
    scopeName(data),
    combo?.velocity != null && `${fmt(combo.velocity, 0)} м/с`,
    ammo?.lot && `партия ${ammo.lot}`,
    options.device !== '*' && devName(options.device),
    options.rest !== '*' && restName(options.rest),
  ];
}

export function cardText(data: CardData, options: CardExportOptions): string {
  const { rifle, scope, ammo, points, rows } = data;
  const zero = points.zero;
  const digits = unitDigits(scope);
  const wind = hasWind(data, options);
  const lines = [
    `${rifle.name} — ${ammoName(ammo)}`,
    subtitle(data, options).filter(Boolean).join(', '),
    `Ноль ${zero ? zero.dist : '—'} м${zero && !zero.derived ? ` от ${rdate(zero.date)}` : ''}, ${unitLabel(unitsOf(scope))}`,
  ];
  if (options.group) {
    const { avg, best, n } = options.group;
    const unit = options.groupUnit;
    lines.push(`Кучность ${fmtAng(avg, unit)} (лучшая ${fmtAng(best, unit)}, ${n} гр.)`);
  }
  lines.push('', ['м', 'Верт', 'Щелч', ...(wind ? ['Ветер/1мс'] : [])].join('\t'));
  for (const row of rows) {
    const cells = [
      String(row.d),
      `${row.e.exact ? '' : '≈'}${fmt(row.e.v, digits)}`,
      String(row.clicks ?? '—'),
    ];
    if (wind) cells.push(row.w ? fmt(row.w.v, 2) : '—');
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

export function cardFileName(data: CardData, options: CardExportOptions): string {
  const [w, h] = options.size === 'strip' ? [4, 12] : [10, 7];
  const scope = scopeName(data);
  const name = `DOPE ${data.rifle.name} ${ammoName(data.ammo)}${scope ? ` ${scope}` : ''} ${w}x${h}см.png`;
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

/** Draws the card at 300 dpi for the chosen print size. */
export async function renderCardPng(data: CardData, options: CardExportOptions): Promise<Blob> {
  try {
    await Promise.all(FONTS.map((font) => document.fonts.load(font, SAMPLE)));
    await document.fonts.ready;
  } catch {
    /* fall back to whatever fonts are available */
  }

  const { rifle, scope, ammo, combo, points, rows } = data;
  const strip = options.size === 'strip';
  const units = unitsOf(scope);
  const digits = unitDigits(scope);
  const wind = hasWind(data, options);
  const dotsPerCm = 300 / 2.54;
  const W = Math.round((strip ? 4 : 10) * dotsPerCm);
  const H = Math.round((strip ? 12 : 7) * dotsPerCm);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#000';
  g.lineWidth = 6;
  g.strokeRect(3, 3, W - 6, H - 6);

  const pad = Math.round(W * 0.04);
  const headH = Math.round(H * (strip ? 0.1 : 0.19));
  const footH = Math.round(H * (strip ? 0.05 : 0.09));
  const available = H - headH - footH - pad * 2;
  const rowH = Math.min(available / (rows.length + 1), H * 0.12);
  const fontSize = Math.floor(rowH * 0.62);
  const fit = (value: string): string => {
    let text = value;
    while (g.measureText(text).width > W - pad * 2 && text.length > 4) {
      text = `${text.slice(0, -2)}…`;
    }
    return text;
  };

  g.fillStyle = '#000';
  g.textBaseline = 'top';
  g.font = `800 ${Math.round(headH * 0.3)}px Tektur, "IBM Plex Sans Condensed", sans-serif`;
  g.fillText(fit(rifle.name), pad, pad);
  g.font = `600 ${Math.round(headH * 0.2)}px "IBM Plex Sans Condensed", sans-serif`;
  g.fillText(
    fit(ammoName(ammo) + (ammo?.lot ? ` · партия ${ammo.lot}` : '')),
    pad,
    pad + headH * 0.36,
  );
  g.font = `500 ${Math.round(headH * 0.17)}px "JetBrains Mono", monospace`;
  const details = [
    rifle.caliber,
    scopeName(data),
    combo?.velocity != null && `${fmt(combo.velocity, 0)} м/с`,
    options.device !== '*' && devName(options.device),
    options.rest !== '*' && restName(options.rest),
    `ноль ${points.zero ? points.zero.dist : '—'} м`,
    unitShort(units),
  ];
  g.fillText(fit(details.filter(Boolean).join(' · ')), pad, pad + headH * 0.64);
  g.fillRect(pad, pad + headH - 6, W - pad * 2, 5);

  const columns: [string, number][] = wind
    ? [
        ['м', 0.12],
        [`Верт ${unitShort(units)}`, 0.45],
        ['Щелч', 0.68],
        ['Ветер 1м/с', 0.98],
      ]
    : [
        ['м', 0.12],
        [`Верт ${unitShort(units)}`, 0.6],
        ['Щелч', 0.95],
      ];
  const x0 = pad;
  const width = W - pad * 2;
  let y = pad + headH + rowH * 0.15;

  g.font = `600 ${Math.round(fontSize * 0.62)}px "IBM Plex Sans Condensed", sans-serif`;
  columns.forEach(([title, position], i) => {
    g.textAlign = i === 0 ? 'left' : 'right';
    g.fillText(title.toUpperCase(), i === 0 ? x0 : x0 + width * position, y + rowH * 0.25);
  });
  y += rowH;
  g.fillRect(x0, y - 3, width, 3);

  rows.forEach((row, i) => {
    if (i % 2) {
      g.fillStyle = '#ebebeb';
      g.fillRect(x0, y, width, rowH);
    }
    g.fillStyle = '#000';
    const textY = y + (rowH - fontSize) / 2;
    g.textAlign = 'left';
    g.font = `700 ${fontSize}px "JetBrains Mono", monospace`;
    g.fillText(String(row.d), x0 + 6, textY);
    g.textAlign = 'right';
    g.font = `${row.e.exact ? '700' : 'italic 400'} ${fontSize}px "JetBrains Mono", monospace`;
    g.fillStyle = row.e.exact ? '#000' : '#555';
    g.fillText(
      `${row.e.exact ? '' : '≈'}${fmt(row.e.v, digits)}`,
      x0 + width * columns[1][1],
      textY,
    );
    g.fillText(String(row.clicks ?? '—'), x0 + width * columns[2][1], textY);
    if (wind) {
      g.font = `${row.w?.exact ? '400' : 'italic 400'} ${fontSize}px "JetBrains Mono", monospace`;
      g.fillStyle = row.w?.exact ? '#000' : '#555';
      g.fillText(row.w ? fmt(row.w.v, 2) : '—', x0 + width * columns[3][1], textY);
    }
    y += rowH;
  });

  g.textAlign = 'left';
  g.fillStyle = '#333';
  g.font = `400 ${Math.round(footH * 0.38)}px "IBM Plex Sans Condensed", sans-serif`;
  const temps = points.temps;
  const min = temps.length ? Math.min(...temps) : null;
  const max = temps.length ? Math.max(...temps) : null;
  const temperature = min != null ? `, t° ${min === max ? min : `${min}…${max}`} °C` : '';
  const grouping = options.group ? ` · кучн. ${fmtAng(options.group.avg, options.groupUnit)}` : '';
  const footer = `По ${points.sessions} стр.${temperature}${grouping} · ${rdate(todayIso())} · ≈ интерполяция`;
  g.fillText(fit(footer), pad, H - pad - footH * 0.6);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('canvas export failed');
  return blob;
}

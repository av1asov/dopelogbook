import { Series } from './model';
import { devName, posName, restName } from './series';

/** A piece of a series' setup; `warn` marks a series shot without the rifle's device. */
export interface SetupPart {
  text: string;
  warn?: boolean;
}

export interface SessionSetup {
  /** «Во всех сериях»: scope · device · position · rest, what every series shares. */
  common: SetupPart[];
  /** What tells each series from the others, by the index of the series. */
  own: Map<number, SetupPart[]>;
}

type Field = 'scope' | 'device' | 'pos' | 'rest';

/** The order in «Во всех сериях» and the order under a card header («лёжа · сошки · ДТК»). */
const COMMON_ORDER: readonly Field[] = ['scope', 'device', 'pos', 'rest'];
const OWN_ORDER: readonly Field[] = ['pos', 'rest', 'device', 'scope'];

/**
 * Splits the setup of the series into what they all share and what differs (spec, screen 3).
 * `series` are the shown ones with their index in the session; `hasDevice` is whether the rifle
 * has a muzzle device, so that shooting without it stands out.
 */
export function sessionSetup(
  series: readonly { series: Series; si: number }[],
  scopeName: (id: string) => string,
  hasDevice: boolean,
): SessionSetup {
  const part = (x: Series, field: Field): SetupPart | null => {
    switch (field) {
      case 'scope':
        return x.scopeId ? { text: scopeName(x.scopeId) } : null;
      case 'device':
        return { text: devName(x.device), ...(hasDevice && !x.device ? { warn: true } : {}) };
      case 'pos':
        return posName(x.pos) ? { text: posName(x.pos) } : null;
      case 'rest':
        return restName(x.rest) ? { text: restName(x.rest) } : null;
    }
  };
  const same = (field: Field): boolean => {
    const texts = new Set(series.map(({ series: x }) => part(x, field)?.text ?? ''));
    return texts.size === 1;
  };
  const shared = new Set(COMMON_ORDER.filter(same));
  const common = COMMON_ORDER.filter((f) => shared.has(f)).flatMap((f) =>
    series.length ? (part(series[0].series, f) ?? []) : [],
  );
  const own = new Map(
    series.map(({ series: x, si }) => [
      si,
      OWN_ORDER.filter((f) => !shared.has(f)).flatMap((f) => part(x, f) ?? []),
    ]),
  );
  return { common, own };
}

/** «Igla Shakal 160» → «Igla 160»: the chip on a series card has little room. */
export function ammoChipName(name: string): string {
  const words = name.trim().split(/\s+/);
  const last = words.at(-1) ?? '';
  return words.length > 2 && /\d/.test(last) ? `${words[0]} ${last}` : name;
}

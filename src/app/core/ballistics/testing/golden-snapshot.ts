import {
  barrelLife,
  cardRows,
  coldStats,
  correctionStability,
  devicesUsed,
  Diary,
  elevEff,
  groupsOf,
  groupStats,
  GroupStats,
  isStable,
  mainScope,
  offsetAtZero,
  restShift,
  restsUsed,
  seriesStatus,
  sessionRounds,
  sessionsOf,
  stanceStats,
  zeroInfo,
} from '../index';

export interface ExampleIds {
  rifle: string;
  hand: string;
  factory: string;
}

const round = (v: number) => +v.toFixed(9);
const group = (g: GroupStats | null) =>
  g ? { n: g.n, avg: round(g.avg), best: round(g.best) } : null;

/** Recomputes everything `example.golden.json` recorded from the original diary. */
export function goldenSnapshot(diary: Diary, ids: ExampleIds): Record<string, unknown> {
  const { rifle: rifleId, hand, factory } = ids;
  const rifle = diary.rifles.find((r) => r.id === rifleId);
  if (!rifle) throw new Error('example rifle not found');
  const scopeId = mainScope(diary, rifle)?.id;
  if (!scopeId) throw new Error('example scope not found');
  const names: Record<string, string> = { [hand]: 'hand', [factory]: 'factory' };

  const card = (ammoId: string, options: Record<string, unknown>) => {
    const { points, rows } = cardRows(diary, rifle, scopeId, ammoId, { step: 50, ...options });
    return {
      sessions: points.sessions,
      temps: points.temps,
      before: points.before,
      rows: rows.map((p) => ({
        d: p.d,
        e: round(p.e.v),
        exact: p.e.exact,
        w: p.w ? round(p.w.v) : null,
        wExact: p.w ? p.w.exact : null,
        clicks: p.clicks,
      })),
    };
  };

  const cards: Record<string, unknown> = {};
  for (const [name, ammoId] of [
    ['hand', hand],
    ['factory', factory],
  ]) {
    for (const step of [25, 50, 100]) cards[`${name}/step${step}`] = card(ammoId, { step });
    for (const device of ['ДТК', 'Глушитель', '']) {
      cards[`${name}/device:${device}`] = card(ammoId, { device });
    }
    for (const rest of ['bipod', 'tripod', 'bench', 'sling']) {
      cards[`${name}/rest:${rest}`] = card(ammoId, { rest });
    }
    cards[`${name}/range`] = card(ammoId, { from: 150, to: 450 });
  }

  const zero = zeroInfo(diary, rifleId, scopeId);
  const cold = coldStats(diary, rifleId);
  const groups = (ammoId: string) =>
    groupsOf(diary, rifleId, ammoId).map((g) => ({
      date: g.session.date,
      dist: g.series.dist,
      a: round(g.angle),
      stable: isStable(g.series),
    }));
  const stability = (ammoId: string) =>
    correctionStability(diary, rifleId, scopeId, ammoId).map((p) => ({
      date: p.session.date,
      dist: p.dist,
      v: round(p.value),
      off: p.deviation != null,
    }));

  return {
    zero: {
      dist: zero?.dist,
      date: zero?.date,
      ammo: names[zero?.ammoId ?? ''],
      derived: zero?.derived,
    },
    cards,
    offsetAtZero: {
      hand: offsetAtZero(diary, rifleId, scopeId, hand),
      factory: offsetAtZero(diary, rifleId, scopeId, factory),
    },
    groupStats: {
      all: group(groupStats(diary, rifleId)),
      hand: group(groupStats(diary, rifleId, hand)),
      factory: group(groupStats(diary, rifleId, factory)),
      allStable: group(groupStats(diary, rifleId, null, true)),
      handStable: group(groupStats(diary, rifleId, hand, true)),
      factoryStable: group(groupStats(diary, rifleId, factory, true)),
    },
    stance: stanceStats(diary, rifleId).map((o) => ({
      pos: o.pos,
      rest: o.rest,
      n: o.n,
      avg: round(o.avg),
    })),
    cold: cold && { n: cold.n, up: round(cold.up), right: round(cold.right) },
    restShift: (restShift(diary, rifleId, scopeId, hand) ?? []).map((o) => ({
      rest: o.rest,
      avg: round(o.avg),
    })),
    devicesUsed: {
      hand: devicesUsed(diary, rifleId, hand),
      factory: devicesUsed(diary, rifleId, factory),
    },
    restsUsed: {
      hand: restsUsed(diary, rifleId, hand),
      factory: restsUsed(diary, rifleId, factory),
    },
    rounds: sessionsOf(diary, rifleId).map((s) => ({
      date: s.date,
      total: sessionRounds(s),
      hand: sessionRounds(s, hand),
      factory: sessionRounds(s, factory),
    })),
    series: sessionsOf(diary, rifleId).map((s) =>
      s.series.map((x) => {
        const status = seriesStatus(x);
        return {
          dist: x.dist,
          use: status.use,
          why: status.why ?? null,
          eff: round(elevEff(x) as number),
        };
      }),
    ),
    groups: { hand: groups(hand), factory: groups(factory) },
    stability: { hand: stability(hand), factory: stability(factory) },
    barrel: barrelLife(diary, rifleId).map((p) => ({ date: p.session.date, total: p.total })),
  };
}

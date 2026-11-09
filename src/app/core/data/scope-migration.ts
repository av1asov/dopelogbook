import {
  Doc,
  Mount,
  Rifle,
  Scope,
  ScopeUnits,
  Series,
  Session,
  ZeroEvent,
} from '../ballistics/model';
import { toMrad } from '../ballistics/series';

/** A rifle before scopes became their own documents: its one scope lived on it. */
export interface RifleV2 extends Omit<Rifle, 'mounts'> {
  units?: 'MIL' | 'MOA';
  click?: number | null;
  sightHeight?: number | null;
  scope?: string;
}

/** A series before zeroing and scopes: angles were in the units of the rifle. */
export type SeriesV2 = Omit<Series, 'kind' | 'scopeId' | 'clicksUp' | 'clicksRight'>;

export interface SessionV2 extends Omit<Session, 'zeroEvents' | 'zeroing' | 'series'> {
  rezero?: { dist: number; ammoId?: string } | null;
  series: SeriesV2[];
}

export interface ScopeMigration {
  scopes: Scope[];
  rifles: Rifle[];
  sessions: Session[];
}

/**
 * The id is derived from the rifle, so a file imported twice, or imported after the
 * database was upgraded, merges with the scope that is already there.
 */
const scopeIdOf = (rifleId: string): string => `scope-${rifleId}`;

const scopeUnits = (r: RifleV2 | undefined): ScopeUnits => (r?.units === 'MOA' ? 'MOA' : 'MRAD');

const meta = (doc: Doc): Doc => ({
  id: doc.id,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
  ...(doc.deletedAt ? { deletedAt: doc.deletedAt } : {}),
});

function migrateRifle(old: RifleV2): { scope: Scope; rifle: Rifle } {
  const { units: _units, click, sightHeight, scope: name, ...rest } = old;
  const scope: Scope = {
    ...meta(old),
    id: scopeIdOf(old.id),
    name: name || 'Прицел',
    type: 'optic',
    units: scopeUnits(old),
    ...(click != null ? { click } : {}),
  };
  const mount: Mount = {
    scopeId: scope.id,
    mounted: true,
    ...(sightHeight != null ? { sightHeight } : {}),
  };
  return { scope, rifle: { ...rest, mounts: [mount] } };
}

function migrateSeries(old: SeriesV2, scopeId: string, units: ScopeUnits): Series {
  return {
    ...old,
    kind: 'normal',
    scopeId,
    ...(old.elev != null ? { elev: toMrad(old.elev, units) } : {}),
    ...(old.windCorr != null ? { windCorr: toMrad(old.windCorr, units) } : {}),
  };
}

function migrateSession(old: SessionV2, units: ScopeUnits): Session {
  const { rezero, series, ...rest } = old;
  const scopeId = scopeIdOf(old.rifleId);
  const session: Session = {
    ...rest,
    series: series.map((x) => migrateSeries(x, scopeId, units)),
  };
  if (rezero && rezero.dist > 0) {
    const ammoId = rezero.ammoId || series[0]?.ammoId;
    const event: ZeroEvent = {
      afterSi: -1,
      dist: rezero.dist,
      scopeId,
      ...(ammoId ? { ammoId } : {}),
    };
    session.zeroEvents = [event];
  }
  return session;
}

/** Moves each rifle's scope into its own document and stores every angle in mrad. */
export function migrateToScopes(rifles: RifleV2[], sessions: SessionV2[]): ScopeMigration {
  const migrated = rifles.map(migrateRifle);
  const byId = new Map(rifles.map((r) => [r.id, r]));
  return {
    scopes: migrated.map((m) => m.scope),
    rifles: migrated.map((m) => m.rifle),
    sessions: sessions.map((s) => migrateSession(s, scopeUnits(byId.get(s.rifleId)))),
  };
}

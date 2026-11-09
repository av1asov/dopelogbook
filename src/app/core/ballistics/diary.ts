import { Ammo, Combo, Diary, Mount, Rifle, Scope, Series, Session } from './model';
import { seriesMatches } from './series';

export const rifleById = (d: Diary, id: string | null | undefined): Rifle | null =>
  d.rifles.find((r) => r.id === id) ?? null;

export const ammoById = (d: Diary, id: string | null | undefined): Ammo | null =>
  d.ammo.find((a) => a.id === id) ?? null;

export const scopeById = (d: Diary, id: string | null | undefined): Scope | null =>
  d.scopes.find((s) => s.id === id) ?? null;

/** The rifle's scopes, the mounted one first. */
export function mountsOf(d: Diary, r: Rifle | null | undefined): { mount: Mount; scope: Scope }[] {
  return (r?.mounts ?? [])
    .flatMap((mount) => {
      const scope = scopeById(d, mount.scopeId);
      return scope ? [{ mount, scope }] : [];
    })
    .sort((a, b) => Number(b.mount.mounted) - Number(a.mount.mounted));
}

/** The mounted scope, or any scope the rifle has when none is mounted. */
export const mainScope = (d: Diary, r: Rifle | null | undefined): Scope | null =>
  mountsOf(d, r)[0]?.scope ?? null;

export const combosOf = (d: Diary, r: Rifle | null | undefined): Combo[] =>
  r ? r.combos.filter((c) => ammoById(d, c.ammoId)) : [];

export const comboOf = (
  d: Diary,
  r: Rifle | null | undefined,
  ammoId: string | null | undefined,
): Combo | null => combosOf(d, r).find((c) => c.ammoId === ammoId) ?? null;

/** Newest first. */
export function sessionsOf(d: Diary, rifleId?: string | null, ammoId?: string | null): Session[] {
  return d.sessions
    .filter(
      (s) =>
        (!rifleId || s.rifleId === rifleId) &&
        (!ammoId || s.series.some((x) => x.ammoId === ammoId)),
    )
    .sort(
      (a, b) =>
        (b.date || '').localeCompare(a.date || '') || b.createdAt.localeCompare(a.createdAt),
    );
}

export const seriesFor = (
  s: Session,
  ammoId: string | null | undefined,
  device = '*',
  rest = '*',
  scopeId?: string | null,
): Series[] => s.series.filter((x) => seriesMatches(x, ammoId, device, rest, scopeId));

export type Units = 'MIL' | 'MOA';
export type Position = 'prone' | 'sit' | 'kneel' | 'stand';
export type Rest = 'bench' | 'bipod' | 'bag' | 'barricade' | 'tripod' | 'sling' | 'none';

export interface Doc {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Combo {
  ammoId: string;
  velocity?: number | null;
}

export interface Rifle extends Doc {
  name: string;
  caliber?: string;
  barrel?: string;
  units: Units;
  click?: number | null;
  sightHeight?: number | null;
  scope?: string;
  devices?: string[];
  notes?: string;
  combos: Combo[];
}

export interface Ammo extends Doc {
  type: 'factory' | 'handload';
  name?: string;
  caliber?: string;
  notes?: string;
  bullet?: string;
  maker?: string;
  line?: string;
  lot?: string;
  powder?: string;
  charge?: number | null;
  chargeUnit?: 'gr' | 'г';
  brass?: string;
  primer?: string;
  coal?: number | null;
}

export interface Series {
  ammoId: string;
  device?: string;
  pos?: Position | '';
  rest?: Rest | '';
  dist?: number | null;
  elev?: number | null;
  windSpeed?: number | null;
  windCorr?: number | null;
  hits?: number | null;
  shots?: number | null;
  /** Group size, mm. */
  group?: number | null;
  /** Group centre relative to the point of aim, mm, positive up. */
  offUp?: number | null;
  /** Group centre relative to the point of aim, mm, positive right. */
  offRight?: number | null;
  skip?: boolean;
  skipReason?: string;
  note?: string;
}

/** The first shot of the day from a cold barrel: outside the group and the DOPE card. */
export interface ColdShot {
  /** Index of the series the shot belongs to. */
  si: number;
  offUp?: number | null;
  offRight?: number | null;
  /**
   * Set on imported records where the cold shot was its own series. It is then counted
   * separately, because no remaining series contains it.
   */
  standalone?: { ammoId?: string; dist?: number | null };
}

export interface Rezero {
  dist: number;
  ammoId?: string;
}

export interface PhotoRef {
  id: string;
  si?: number;
}

export interface Session extends Doc {
  rifleId: string;
  date: string;
  place?: string;
  temp?: number | null;
  pressure?: number | null;
  altitude?: number | null;
  notes?: string;
  extraRounds?: number | null;
  rezero?: Rezero | null;
  coldShot?: ColdShot | null;
  /** The session still in progress on the range; at most one at a time. */
  open?: boolean;
  photos?: PhotoRef[];
  series: Series[];
}

/** Live documents only: soft-deleted ones are filtered out before calculations. */
export interface Diary {
  rifles: readonly Rifle[];
  ammo: readonly Ammo[];
  sessions: readonly Session[];
}

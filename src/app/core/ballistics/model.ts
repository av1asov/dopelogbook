/** MRAD and MIL are the same unit under two names; the scope's own name is what is shown. */
export type ScopeUnits = 'MRAD' | 'MIL' | 'MOA' | 'CM100' | 'MM100';
export type ScopeType = 'optic' | 'thermal' | 'red-dot';
/** Unit for group sizes. Corrections always use the units of their scope. */
export type GroupUnit = 'MOA' | 'MRAD';
export type Position = 'prone' | 'sit' | 'kneel' | 'stand';
export type Rest = 'bench' | 'bipod' | 'bag' | 'barricade' | 'tripod' | 'sling' | 'none';
export type SeriesKind = 'normal' | 'zeroing';

export interface Doc {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Scope extends Doc {
  name: string;
  type: ScopeType;
  units: ScopeUnits;
  /** One click, in the scope's units. */
  click?: number | null;
  magnification?: string;
  notes?: string;
}

export interface Combo {
  ammoId: string;
  velocity?: number | null;
}

export interface Mount {
  scopeId: string;
  /** Height over the bore, mm. It depends on the mount, so it belongs to the rifle. */
  sightHeight?: number | null;
  /** At most one scope per rifle is mounted. */
  mounted: boolean;
}

export interface Rifle extends Doc {
  name: string;
  caliber?: string;
  barrel?: string;
  devices?: string[];
  notes?: string;
  combos: Combo[];
  mounts: Mount[];
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
  /** `zeroing` counts towards barrel life only: never the card, groups or statistics. */
  kind: SeriesKind;
  scopeId: string;
  ammoId: string;
  device?: string;
  pos?: Position | '';
  rest?: Rest | '';
  dist?: number | null;
  /** Elevation, mrad. Shown in the units of the series' scope. */
  elev?: number | null;
  windSpeed?: number | null;
  /** Windage, mrad, positive right. Shown in the units of the series' scope. */
  windCorr?: number | null;
  hits?: number | null;
  shots?: number | null;
  /** Group size, mm. */
  group?: number | null;
  /** Group centre relative to the point of aim, mm, positive up. */
  offUp?: number | null;
  /** Group centre relative to the point of aim, mm, positive right. */
  offRight?: number | null;
  /** Zeroing only: clicks dialled after the series, positive up. */
  clicksUp?: number | null;
  /** Zeroing only: clicks dialled after the series, positive right. */
  clicksRight?: number | null;
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

/** The zero was set after series `afterSi` (−1: before the first one), for one scope only. */
export interface ZeroEvent {
  afterSi: number;
  dist: number;
  ammoId?: string;
  scopeId: string;
}

/** What is being zeroed while the range screen is in zeroing mode. */
export interface ZeroingPlan {
  dist: number;
  ammoId: string;
  scopeId: string;
}

/** A position on a photo, in the pixels of the original image. */
export interface Point {
  x: number;
  y: number;
}

export interface SheetSize {
  w: number;
  h: number;
}

export interface PhotoHole extends Point {
  /** Found by the automatic search rather than placed by hand. */
  auto: boolean;
  /** The first shot from a cold barrel: stays out of the group. */
  cold?: boolean;
}

/** Where the scale came from, most reliable first. */
export type ScaleSource = 'sheet' | 'element' | 'card' | 'manual';

export interface PhotoScale {
  source: ScaleSource;
  p1: Point;
  p2: Point;
  mm: number;
  /** The size of the rectified sheet, when the source is the sheet. */
  sheet?: SheetSize;
}

/** One target on the photo; a sheet can hold several. */
export interface PhotoTarget {
  n: number;
  /** The series this target went to; on a one-target photo that is the `si` of the photo. */
  si?: number;
  aim?: Point | null;
  holes: PhotoHole[];
}

/** What was measured on a target photo; enough to reopen it and recalculate. */
export interface PhotoMarks {
  templateId?: string;
  scale: PhotoScale;
  /** From image pixels to millimetres on the rectified plane, row by row. */
  homography?: number[];
  targets: PhotoTarget[];
}

export interface PhotoRef {
  id: string;
  /** Absent on a sheet of several targets: their series are in `marks.targets`. */
  si?: number;
  marks?: PhotoMarks;
}

/** Whether a printed element is darker or lighter than what surrounds it. */
export type Polarity = 'dark' | 'light';

/** One printed ring, by the edges that can be seen on it. */
export type TargetRing =
  | { edge: 'light-disc' | 'dark-disc'; d: number; label?: string }
  | { edge: 'light-ring'; dIn: number; dOut: number; label?: string };

/** The printed element a target is recognised by, in mm. */
export type TargetReference =
  | { kind: 'square'; size: number; polarity?: Polarity }
  | { kind: 'circle'; size: number; polarity?: Polarity }
  | { kind: 'grid'; step: number }
  /** `diameters` lists every edge; `rings` says what each edge separates, when that is known. */
  | { kind: 'rings'; diameters: number[]; rings?: TargetRing[] };

export interface TemplateTarget {
  n: number;
  /** Centre of the reference, mm; only the distances between targets are relied on. */
  x: number;
  y: number;
  reference: TargetReference;
  /** Point of aim from the centre of the reference, mm. */
  aim?: { up: number; right: number } | null;
}

export interface TargetTemplate extends Doc {
  name: string;
  /** Used for perspective only: the drawing can lie anywhere on it, and turned. */
  sheet: SheetSize;
  /** The drawing, when it is smaller than the sheet it is printed on. */
  artSize?: SheetSize;
  targets: TemplateTarget[];
  /** Numbers follow the print rather than the order of the targets on the photo. */
  numbering?: 'printed';
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
  zeroEvents?: ZeroEvent[];
  coldShot?: ColdShot | null;
  /** The session still in progress on the range; at most one at a time. */
  open?: boolean;
  /** Present while the open session is zeroing. */
  zeroing?: ZeroingPlan | null;
  photos?: PhotoRef[];
  series: Series[];
}

/** Live documents only: soft-deleted ones are filtered out before calculations. */
export interface Diary {
  scopes: readonly Scope[];
  rifles: readonly Rifle[];
  ammo: readonly Ammo[];
  sessions: readonly Session[];
}

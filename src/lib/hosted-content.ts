/**
 * What a copy of the game can list.
 *
 * The upstream repository carries only RISE Motordrome and the 2026 prototype car (`lc26`, with its body, liveries,
 * and sound in `public/cars/f12026/` and `public/lc26/`); all other cars, circuits, shared tyre packs, and the
 * classical soundtrack live on librecorsa.org's asset bucket and are gitignored in `public/`.
 *
 * In LibreCorsa Offline:
 *  - Run `npm run sync:content` once (while online) to download any or all hosted cars, circuits, shared tyre packs,
 *    and soundtrack MP3s into local `public/` for 100% air-gapped offline play.
 *  - `scripts/run-next.mjs` automatically scans `public/` at build/dev time and populates
 *    `NEXT_PUBLIC_LOCAL_CAR_IDS`, `NEXT_PUBLIC_LOCAL_TRACK_IDS`, `NEXT_PUBLIC_LOCAL_MUSIC`, and
 *    `NEXT_PUBLIC_LOCAL_SHARED_TYRES`, so every locally installed car/circuit appears automatically without needing
 *    to set `NEXT_PUBLIC_HOSTED_CONTENT=1` manually.
 *  - Setting `NEXT_PUBLIC_HOSTED_CONTENT=1` still lists everything (used by verification scripts and full deploys).
 */
const parseCsvSet = (raw: string | undefined): ReadonlySet<string> =>
  new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

export const HOSTED_CONTENT = process.env.NEXT_PUBLIC_HOSTED_CONTENT === "1";

/** Cars bundled in the git repository */
export const REPO_CAR_IDS: ReadonlySet<string> = new Set(["lc26"]);

/** Circuits bundled in the git repository */
export const REPO_TRACK_IDS: ReadonlySet<string> = new Set(["rwanda_official_short", "rwanda_official"]);

/** Additional cars present locally in `public/cars/` (auto-detected by `scripts/run-next.mjs`) */
export const LOCAL_CAR_IDS: ReadonlySet<string> = parseCsvSet(process.env.NEXT_PUBLIC_LOCAL_CAR_IDS);

/** Additional circuits present locally in `public/tracks/` (auto-detected by `scripts/run-next.mjs`) */
export const LOCAL_TRACK_IDS: ReadonlySet<string> = parseCsvSet(process.env.NEXT_PUBLIC_LOCAL_TRACK_IDS);

/** Whether local soundtrack MP3s are available under `public/music/` */
export const HAS_LOCAL_MUSIC = HOSTED_CONTENT || process.env.NEXT_PUBLIC_LOCAL_MUSIC === "1";

/** Whether shared tyre textures are available under `public/cars/shared/tyres/` */
export const HAS_SHARED_TYRES = HOSTED_CONTENT || process.env.NEXT_PUBLIC_LOCAL_SHARED_TYRES === "1";

/** Whether this copy lists a car */
export const carListed = (id: string): boolean => HOSTED_CONTENT || REPO_CAR_IDS.has(id) || LOCAL_CAR_IDS.has(id);

/** Whether this copy lists a circuit */
export const trackListed = (id: string): boolean => HOSTED_CONTENT || REPO_TRACK_IDS.has(id) || LOCAL_TRACK_IDS.has(id);

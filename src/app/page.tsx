import { existsSync } from "node:fs";
import { join } from "node:path";
import { HomeHub } from "@/components/home/HomeHub";
import type { HomeData, HomeLivery, HomeVenueHero, WhatsNewDay } from "@/components/home/home-data";
import { withBasePath } from "@/lib/base-path";
import {
  CAR_CLASSES,
  CARS,
  anyCarForVehicle,
  carLiveryThumbUrl,
  carSkinSwatchBackground,
  carSkinThumbUrl,
  carTakesLivery,
  carThumbUrl,
  type CarDefinition,
  type CarId,
} from "@/lib/cars/car-registry";
import { carBoardTag } from "@/lib/cars/board-tag";
import { LIVERIES, LIVERY_CATEGORY_LABELS } from "@/lib/track-data";
import { VEHICLE_MODEL_IDS, type LiveryConfig, type VehicleModelId } from "@/types/f1";
import outlines from "@/lib/home/circuit-outlines.json";
import whatsNewJson from "@/lib/home/whats-new.json";
import type { LapOutline } from "@/lib/home/lap-outline";
import { carModelSource, trackModelSource } from "@/lib/model-source";
import { moddersList } from "@/lib/modders";
import { homeQualityText } from "@/lib/home/quality";
import { CONTACT_EMAIL, REPO_URL, SUPPORT_URL } from "@/lib/site";
import { CIRCUIT_TYPE_LABELS, CIRCUIT_VENUES, DEFAULT_TRACK_ID, VENUE_HERO_WIDTHS, circuitModder, circuitType, venueHeroUrl } from "@/lib/track-registry";

/** Written by scripts/build-home-outlines.ts, so its shape is LapOutline's (JSON reads a tuple as an array) */
const OUTLINES = outlines as unknown as Record<string, LapOutline>;

/**
 * A car's picture, or null when this offline build doesn't have the file locally under `public/`.
 */
function variantThumbOf(_id: CarId, url: string): string | null {
  if (!existsSync(join(process.cwd(), "public", url))) return null;
  return withBasePath(url);
}

function thumbOf(id: CarId): string | null {
  return variantThumbOf(id, carThumbUrl(id));
}

/**
 * A venue's scenic Drive-tile hero still, or null when this offline build doesn't have it locally under `public/`.
 */
function venueHeroOf(venueId: string): HomeVenueHero | null {
  const full = venueHeroUrl(venueId, 1600);
  if (!existsSync(join(process.cwd(), "public", full))) return null;
  const availableWidths = VENUE_HERO_WIDTHS.filter((w) => existsSync(join(process.cwd(), "public", venueHeroUrl(venueId, w))));
  const widths = availableWidths.length ? availableWidths : ([1600] as const);
  return {
    src: withBasePath(full),
    srcSet: widths.map((w) => `${withBasePath(venueHeroUrl(venueId, w))} ${w}w`).join(", "),
  };
}

const F1_SWATCH = (liv: LiveryConfig): string =>
  liv.visual?.swatchCss ?? `linear-gradient(130deg, ${liv.primary} 0 52%, ${liv.accent} 52% 64%, ${liv.secondary} 64% 100%)`;

const F1_LIVERY_ORDER = ["house", "grid2026", "retro"] as const;

function liveriesOf(c: CarDefinition): { liveryStore?: "settings" | "skin"; liveries: HomeLivery[] } {
  if (carTakesLivery(c.id)) {
    const ordered = F1_LIVERY_ORDER.flatMap((cat) =>
      LIVERIES.filter((liv) => (liv.category ?? "house") === cat).map((liv) => ({
        id: liv.id,
        name: liv.name,
        detail: liv.team,
        group: LIVERY_CATEGORY_LABELS[cat],
        swatch: F1_SWATCH(liv),
        thumb: variantThumbOf(c.id, carLiveryThumbUrl(c.id, liv.id)),
      })),
    );
    return { liveryStore: "settings", liveries: ordered };
  }
  if (c.skins && c.skins.length > 1) {
    return {
      liveryStore: "skin",
      liveries: c.skins.map((skin) => ({
        id: skin.id,
        name: skin.name,
        swatch: carSkinSwatchBackground(skin),
        thumb: variantThumbOf(c.id, carSkinThumbUrl(c.id, skin.id)),
      })),
    };
  }
  return { liveries: [] };
}

/**
 * The cars of each online board: the listed cars on it in menu order, else (a preview car, which a weekly challenge
 * may run) the one the game knows. The rigid-body model's old F1 board has no car and is left out.
 */
function boardCarsByVehicle(): Map<VehicleModelId, CarDefinition[]> {
  const byVehicle = new Map<VehicleModelId, CarDefinition[]>();
  for (const c of CARS) byVehicle.set(c.physics, [...(byVehicle.get(c.physics) ?? []), c]);
  for (const v of VEHICLE_MODEL_IDS) {
    const known = v === "f12026-car" ? undefined : anyCarForVehicle(v);
    if (known && !byVehicle.has(v)) byVehicle.set(v, [known]);
  }
  return byVehicle;
}

/** The home page: the game's circuits, cars and press, with Drive into the game at /play */
export default function HomePage() {
  const missing = CIRCUIT_VENUES.flatMap((v) => v.layouts.filter((t) => !OUTLINES[t.id]).map((t) => t.id));
  if (missing.length) console.warn(`Home page: no outline for ${missing.join(", ")} (npm run home-outlines)`);
  const boardCarList = [...boardCarsByVehicle()];

  const data: HomeData = {
    defaultTrackId: DEFAULT_TRACK_ID,
    defaultCarId: CARS[0].id,
    venues: CIRCUIT_VENUES.map((v) => ({
      id: v.id,
      name: v.name,
      country: v.country,
      types: [...new Set(v.layouts.map((t) => CIRCUIT_TYPE_LABELS[circuitType(t)]))],
      typeIds: [...new Set(v.layouts.map(circuitType))],
      modders: [...new Set(v.layouts.map(circuitModder))],
      layouts: v.layouts.map((t) => ({
        id: t.id,
        layout: t.layout,
        lengthM: t.lengthM,
        turns: t.turns,
        quality: t.quality,
        outline: OUTLINES[t.id] ?? null,
      })),
      hero: venueHeroOf(v.id),
      source: trackModelSource(v.layouts[0]),
    })),
    cars: CARS.map((c) => {
      const { liveryStore, liveries } = liveriesOf(c);
      return {
        id: c.id,
        vehicle: c.physics,
        title: c.title,
        classTitle: CAR_CLASSES.find((k) => k.id === c.classId)?.title ?? "",
        classId: c.classId,
        year: c.year,
        quality: c.quality,
        thumb: thumbOf(c.id),
        liveryStore,
        liveries,
        source: carModelSource(c),
      };
    }),
    qualityText: homeQualityText(),
    coverage: [],
    coverageCount: 0,
    contactEmail: CONTACT_EMAIL,
    repoUrl: REPO_URL,
    supportUrl: SUPPORT_URL,
    modders: moddersList(),
    boardCars: Object.fromEntries(VEHICLE_MODEL_IDS.map((v) => [v, carBoardTag(v)])),
    // A board two cars share is named for the first, with the other under it
    boardCarChoices: boardCarList.map(([id, [first, ...others]]) => ({
      id,
      label: first.title,
      ...(others.length ? { detail: `Shared with the ${others.map((c) => c.title).join(", ")}` } : {}),
    })),
    carTitles: Object.fromEntries(boardCarList.flatMap(([, cars]) => cars.map((c) => [c.id, c.title]))),
    whatsNew: whatsNewJson as WhatsNewDay[],
  };

  // Old links to "/" that belong to the game go on to /play from the root layout (forward-to-game.ts)
  return <HomeHub data={data} />;
}

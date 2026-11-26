/**
 * Offline local lap leaderboard: reads personal bests saved locally in IndexedDB (ghost-store.ts).
 * Online submission, remote boards, and remote ghosts are disabled in this offline build.
 */
import type { VehicleModelId } from "@/types/f1";
import type { LapRecording, LeaderboardEntry } from "@/lib/sim/lap-types";
import { listBestLaps } from "@/lib/sim/ghost-store";

export { boardLabel, driverNameKey, type BoardFilter } from "./board-client";

export interface RemoteBoard {
  entries: LeaderboardEntry[];
  total: number;
  me?: { rank: number; entry: LeaderboardEntry; aboveMs?: number } | null;
  physics: number;
}

export interface QueuedMiss {
  key: string;
  lapTimeMs: number;
  recordedAt: number;
  error: string | null;
}

export function queuedBoardMisses(): QueuedMiss[] {
  return [];
}

export async function boardOnline(): Promise<boolean> {
  return false;
}

/** Board row for a lap: its driver, time and car, without the samples */
export function lapToEntry(rec: LapRecording, source: "local" | "remote", id?: string): LeaderboardEntry {
  const entry: LeaderboardEntry = {
    name: rec.driverName,
    code: rec.driverCode,
    lapTimeMs: rec.lapTimeMs,
    sectorTimesMs: [rec.sectorTimesMs[0], rec.sectorTimesMs[1], rec.sectorTimesMs[2]],
    vehicle: rec.vehicle,
    trackId: rec.trackId,
    recordedAt: rec.recordedAt,
    source,
  };
  if (rec.conditions) entry.conditions = { ...rec.conditions };
  if (id !== undefined) entry.id = id;
  if (rec.setup) {
    entry.hasSetup = true;
    entry.setup = rec.setup;
  }
  return entry;
}

/** Local personal bests for this circuit (all cars, or one car), fastest first */
export async function localLeaderboard(trackId: string, vehicle?: VehicleModelId): Promise<LeaderboardEntry[]> {
  const laps = await listBestLaps();
  return laps
    .filter((lap) => lap.trackId === trackId && (vehicle === undefined || lap.vehicle === vehicle))
    .map((lap) => lapToEntry(lap, "local"))
    .sort((a, b) => a.lapTimeMs - b.lapTimeMs);
}

/** Local personal bests across all circuits and cars, fastest first */
export async function allLocalLeaderboards(): Promise<LeaderboardEntry[]> {
  const laps = await listBestLaps();
  return laps.map((lap) => lapToEntry(lap, "local")).sort((a, b) => a.lapTimeMs - b.lapTimeMs);
}

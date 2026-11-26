"use client";

/**
 * Offline build: personal-best row selector for the circuit browser detail panel.
 * Online board ranking fetches are permanently disabled.
 */
import type { VehicleModelId } from "@/types/f1";

export interface CircuitBoardRank {
  pos: number;
  rank: number;
  total: number;
  lapTimeMs: number;
}

export interface DetailPbEntry {
  vehicle: VehicleModelId;
  lapTimeMs: number;
  legacyPhysics: boolean;
}

const EMPTY_RANKS: Readonly<Partial<Record<VehicleModelId, CircuitBoardRank>>> = {};

/** At most 4 PB rows in the detail panel, always keeping the currently selected car when it has a PB */
export function selectDetailPbs(circuitPbs: readonly DetailPbEntry[], vehicleModel?: VehicleModelId): DetailPbEntry[] {
  const top = circuitPbs.slice(0, 4);
  if (vehicleModel && !top.some((e) => e.vehicle === vehicleModel)) {
    const mine = circuitPbs.find((e) => e.vehicle === vehicleModel);
    if (mine) top.splice(3, 1, mine);
  }
  return top;
}

export function invalidateCircuitBoardRank(_trackId: string, _vehicle: VehicleModelId, _physics?: number): void {}

export function useCircuitBoardRanks(
  _trackId: string,
  _entries: readonly DetailPbEntry[],
  _driverName: string | undefined,
  _boardVersion = 0,
): Readonly<Partial<Record<VehicleModelId, CircuitBoardRank>>> {
  return EMPTY_RANKS;
}

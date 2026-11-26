/**
 * Offline build: pure local formatting utilities for lap conditions and driver names.
 * All remote board requests are disabled and return null without touching the network.
 */
import type { AssistPreset, VehicleModelId } from "@/types/f1";
import type { LeaderboardEntry } from "@/lib/sim/lap-types";
import type { SimRealism } from "@/lib/sim/sim-realism";
import { t } from "@/i18n/runtime";

export const ALL_CARS = "all";
export type BoardCar = VehicleModelId | typeof ALL_CARS;

export const BOARD_PAGE_SIZE = 20;

export interface BoardFilter {
  assists?: AssistPreset;
  realism?: SimRealism;
  surface?: "dry" | "wet";
}

export interface BoardPage {
  entries: LeaderboardEntry[];
  total: number;
  offset: number;
  limit: number;
  me?: { rank: number; entry: LeaderboardEntry; aboveMs?: number } | null;
}

export interface CircuitTotals {
  drivers: number;
  laps: number;
}

const ASSIST_LABEL = {
  pro: "game.board.assistsPro",
  semi_pro: "game.board.assistsSemiPro",
  assisted: "game.board.assistsAssisted",
} as const satisfies Record<AssistPreset, string>;

const REALISM_LABEL = {
  casual: "game.board.realismCasual",
  standard: "game.board.realismStandard",
  full: "game.board.realismFull",
} as const satisfies Record<SimRealism, string>;

/** "No assists · Full · Dry": what a lap was driven with */
export function boardLabel(c: { assists: AssistPreset; realism: SimRealism; surface: "dry" | "wet" }): string {
  return t("game.board.conditions", {
    assists: t(ASSIST_LABEL[c.assists]),
    realism: t(REALISM_LABEL[c.realism]),
    surface: t(c.surface === "wet" ? "game.board.surfaceWet" : "game.board.surfaceDry"),
  });
}

/** "1,204": a count grouped by thousands */
export const formatCount = (n: number): string => n.toLocaleString("en-US");

/** Normalised driver key */
export function driverNameKey(name: string): string {
  return name.replace(/^ +| +$/g, "").replace(/[ \t\n\r\f\v]+/g, " ").toLowerCase();
}

export async function fetchBoardPage(): Promise<BoardPage | null> {
  return null;
}

export async function fetchCircuitTotals(): Promise<CircuitTotals | null> {
  return null;
}

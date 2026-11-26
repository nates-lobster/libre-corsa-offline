/**
 * Offline build: all online server features are permanently disabled.
 * No outbound network requests, timers, or WebSockets are ever created.
 */

export interface OnlineConfig {
  rooms: boolean;
  relay: boolean;
  races: boolean;
  board: boolean;
  raceSlotS: number;
  usage: boolean;
  live: boolean;
  accounts: boolean;
  accountProviders: readonly string[];
}

export type OnlineReach = "ok" | "unreachable" | "none";

export interface OnlineState {
  config: OnlineConfig;
  reach: OnlineReach;
}

export type BoardState = "on" | "off" | "unreachable";

const OFF_CONFIG: OnlineConfig = {
  rooms: false,
  relay: false,
  races: false,
  board: false,
  raceSlotS: 1200,
  usage: false,
  live: false,
  accounts: false,
  accountProviders: [],
};

const OFFLINE_STATE: OnlineState = { config: OFF_CONFIG, reach: "none" };

export const onlineApiBase: string | null = null;

export function onlineUrl(_path: string): string | null {
  return null;
}

export function onlineSocketUrl(_path: string, _pageOrigin?: string): string | null {
  return null;
}

export function boardStateOf(_s: OnlineState): BoardState {
  return "off";
}

export function getOnlineConfig(): Promise<OnlineConfig> {
  return Promise.resolve(OFF_CONFIG);
}

export function readOnlineConfig(): Promise<OnlineState> {
  return Promise.resolve(OFFLINE_STATE);
}

export function watchOnlineConfig(listener: (state: OnlineState) => void): () => void {
  listener(OFFLINE_STATE);
  return () => {};
}

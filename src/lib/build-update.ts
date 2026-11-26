/**
 * Offline build: automatic deploy update polling (/build.json) is disabled.
 */

export interface BuildInfo {
  build: string;
  protocol: number | null;
}

export interface UpdateState {
  ready: boolean;
  latest: string;
  protocolChanged: boolean;
}

const NONE: UpdateState = { ready: false, latest: "", protocolChanged: false };

export const updateStore = {
  subscribe(_listener: () => void): () => void {
    return () => {};
  },
  getSnapshot: (): UpdateState => NONE,
  getServerSnapshot: (): UpdateState => NONE,
};

export function checkForUpdate(_force = false): Promise<UpdateState> {
  return Promise.resolve(NONE);
}

export function watchForUpdates(): () => void {
  return () => {};
}

export function reloadForUpdate(): void {
  if (typeof window !== "undefined") window.location.reload();
}

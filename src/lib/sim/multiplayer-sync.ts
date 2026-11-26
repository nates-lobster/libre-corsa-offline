/**
 * Offline build: multiplayer networking (WebRTC, PeerJS, STUN/TURN, room & race servers) is removed.
 * This module retains only the shared peer pose types used by the local AI race field, ghost cars,
 * podium director, opponent audio, and visual FX, plus a no-op stub manager for DriveSession compatibility.
 */
import * as THREE from 'three';
import type { CustomLiveryColors, VehicleModelId } from '@/types/f1';
import type { TyreVisualState } from './simulator-car';
import type { GroundQuery } from './f12026-car/TrackColliderQuery';
import {
  MP_QUALIFYING_MINUTES,
  sanitizePacket,
  withLobbyDefaults,
  type CarClassRule,
  type CollisionMode,
  type LobbyPlayer,
  type LobbySettings,
  type LobbyState,
  type MpGridOrder,
  type MpQualifyingMinutes,
  type MpRaceRules,
  type MpStartType,
  type NetworkVehiclePacket,
  type PeerRaceProgress,
  type QualifyingTime,
  type RaceStartInfo,
  type RoomKind,
  type RoomPhase,
  type RoomSessionInfo,
} from '@/lib/net/wire';

export { MP_QUALIFYING_MINUTES, sanitizePacket, withLobbyDefaults };
export type {
  CarClassRule,
  CollisionMode,
  LobbyPlayer,
  LobbySettings,
  LobbyState,
  MpGridOrder,
  MpQualifyingMinutes,
  MpRaceRules,
  MpStartType,
  NetworkVehiclePacket,
  PeerRaceProgress,
  QualifyingTime,
  RaceStartInfo,
  RoomKind,
  RoomPhase,
  RoomSessionInfo,
};

export interface InterpolatedPeerState {
  peerId: string;
  driverCode: string;
  teamColorHex: string;
  liveryId?: string | null;
  customLivery?: CustomLiveryColors;
  vehicle?: VehicleModelId;
  trackId?: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  linearVelocity: THREE.Vector3;
  steerAngle: number;
  wheelRPMs: [number, number, number, number];
  throttle: number;
  brake: number;
  trackS: number;
  speedKmh: number;
  isAiPeer: boolean;
  aheadM?: number;
  name?: string;
  race?: PeerRaceProgress;
  ghost?: boolean;
  yawRateRadS?: number;
  contactReady?: boolean;
  stale?: boolean;
  hazard?: boolean;
  flash?: boolean;
  passThrough?: boolean;
  rpm?: number;
  gear?: number;
  contact?: boolean;
  wheels?: { tyres?: readonly TyreVisualState[]; ground: GroundQuery | null };
}

export interface PeerNetStats {
  peerId: string;
  name: string;
  code: string;
  rttMs: number | null;
  lossPct: number;
  jitterMs: number;
  relayed: boolean;
}

export interface DriverIdentity {
  name: string;
  code: string;
  color: string;
}

export interface P2PConnectionStatus {
  mode: 'local' | 'room_host' | 'room_guest' | 'manual_sdp' | 'race_server';
  roomCode: string;
  state: 'idle' | 'signaling' | 'connected' | 'error';
  connectedWebRtcPeers: number;
  statusText: string;
}

export interface ScheduledRaceStatus {
  state: 'idle' | 'joining' | 'joined' | 'error';
  startsMs: number | null;
  text: string;
}

/** Offline no-op manager: never opens sockets, WebRTC connections, or timers. */
export class MultiplayerSyncManager {
  public readonly localPeerId = 'offline-local';
  public readonly isHost = false;
  public readonly hostId: string | null = null;
  public readonly lobby: LobbyState | null = null;
  public readonly activeQualifying: RoomSessionInfo | null = null;
  public readonly clockSynced = false;
  public readonly inScheduledRace = false;

  public readonly status: P2PConnectionStatus = {
    mode: 'local',
    roomCode: '',
    state: 'idle',
    connectedWebRtcPeers: 0,
    statusText: 'Offline',
  };

  public onStatusChange?: (status: P2PConnectionStatus) => void;

  public hostNowMs(localMs: number): number {
    return localMs;
  }

  public reportQualifyingLap(_lapMs: number): void {}

  public leaveRace(): void {}

  public disconnect(): void {}

  public update(
    _nowMs: number,
    _localPacket?: Omit<NetworkVehiclePacket, 'peerId' | 'timestampMs'> | null,
  ): InterpolatedPeerState[] {
    return [];
  }
}

let singleton: MultiplayerSyncManager | null = null;

export function getMultiplayerManager(): MultiplayerSyncManager {
  if (!singleton) singleton = new MultiplayerSyncManager();
  return singleton;
}

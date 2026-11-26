"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "use-intl/react";
import { t as tr } from "@/i18n/runtime";
import { DEFAULT_TRACK_ID, TURN_METADATA, getActivePointToPoint, getActiveTrackData, resolveLivery } from "@/lib/track-data";
import { FfbPairPrompt } from "@/components/hud/FfbPairPrompt";
import { DualSensePairPrompt } from "@/components/hud/DualSensePairPrompt";
import { OverheadNameplates } from "@/components/hud/OverheadNameplates";
import type { OverheadNameplatesSink } from "@/lib/render/overhead-nameplates";
import { isVehicleModelId } from "@/lib/cars/vehicle-models";
import { carById, carForVehicle, type CarId } from "@/lib/cars/car-registry";
import { alignGhostToTrack } from "@/lib/sim/ghost-align";
import { carPhysics, carTakesPhysicsSwitch, subscribeF1ModPhysics } from "@/lib/cars/f1-mod-physics";
import { type ChassisSetup, saveChassisSetup } from "@/lib/sim/car-setup";
import { TrackEnvironment } from "@/lib/sim/track-environment";
import { installErrorLog } from "@/lib/diagnostics/error-log";
import { GhostPlayer } from "@/lib/sim/lap-recorder";
import { lapBoardClass, lapConditionsNow, type LapConditions, type LapRecording, type LapSummaryData, type LeaderboardEntry } from "@/lib/sim/lap-types";
import { exportLapFile, importLapFile, listBestLaps, loadBestLap, loadLatestLap, saveBestLapIfFaster, saveLatestLap } from "@/lib/sim/ghost-store";
import { recordDrivingTime, recordLapDistance } from "@/lib/sim/driver-stats";
import { sectorSplitsFromSamples, selectCarBestLap, type SessionLapEntry } from "@/lib/sim/lap-analysis";
import { LapTelemetryModal } from "@/components/hud/LapTelemetryModal";
import { lapToEntry, localLeaderboard } from "@/lib/net/leaderboard";
import { isTouchDevice, resetTouchInput } from "@/lib/input/touch-input";
import { isFatalHidStatus } from "@/lib/input/webhid-ffb";
import { SIM_REALISM_FLAGS, type SimRealism } from "@/lib/sim/sim-realism";
import { applyConditionsChoice, resolveTimeOfDay, type SessionConditions } from "@/lib/sim/weather";
import { getTrackInfo, trackDefaultTimeOfDay, TRACKS } from "@/lib/track-registry";
import { F1TelemetryHud } from "@/components/F1TelemetryHud";
import { CAMERA_MODES, nextCameraMode } from "@/lib/render/camera-modes";
import { clampTyreSetup, saveTyreSetup } from "@/lib/sim/tyre-setup";
import { garageTunerFrom, resolveSetupForCar, summarizeSharedSetup } from "@/lib/sim/setup-share";
import { LoadingScreen } from "@/components/menu/LoadingScreen";
import { TitleMenu } from "@/components/menu/TitleMenu";
import { FirstRunWizard, type WizardMode, type WizardStepId } from "@/components/menu/FirstRunWizard";
import { SettingsScreen, type SettingsCategory } from "@/components/settings/SettingsScreen";
import type { SettingsEnv } from "@/components/settings/env";
import { applyInterfaceSettings } from "@/lib/settings/ui-prefs";
import { keyLabel, padButtonLabel, pressPedalText } from "@/lib/input/bindings";
import { useKeyLayout } from "@/lib/input/use-key-layout";
import { autoConfigureWheel, connectedPads } from "@/lib/input/device-input";
import { dualSenseHid } from "@/lib/input/webhid-dualsense";
import { dualShock4Hid } from "@/lib/input/webhid-dualshock4";
import { webHidFfb, wheelFfb } from "@/lib/input/wheel-ffb";
import { nameProblem } from "@/lib/net/name-filter";
import { clampFov, codeFromName, DEFAULT_PLAYER_SETTINGS, loadCarChoice, loadOnboarded, loadPlayerSettings, loadRumble, pushLibraryRecent, saveCarChoice, saveOnboarded, toggleLibraryFavorite, type LibraryKind, sanitizeDriverName, savePlayerSettings, saveRumble, type PlayerSettings } from "@/lib/settings/player-settings";
import type { AeroSetupPreset, AssistPreset, CameraMode, LiveTunerPatch, LiveryConfig, TireCompound, TyreSetup, VehicleModelId } from "@/types/f1";
import { aiFieldOf, autoCompoundFor, DEFAULT_AERO_PRESET, DriveSession, idleDriveSnapshot, WebGLUnavailableError, type AppPhase, type SessionRace } from "@/lib/drive-session";
import { GpuLostNotice } from "@/components/menu/GpuLostNotice";
import { NowPlayingToast } from "@/components/hud/NowPlayingToast";
import { browserStore, lostRecently, probeRenderer, settleLoss } from "@/lib/render/gpu-health";
import { startAiRace, type RaceSetup } from "@/lib/sim/race-setup";
import type { PodiumUi } from "@/lib/render/podium-shot";
import { useRaceHistory } from "@/components/hud/useRaceHistory";
import { isNudgeView, markSeatHintSeen, nudgeOf, seatHintSeen, stepNudge, type CameraNudge, type NudgeView } from "@/lib/settings/camera-nudges";
import { dashViewFovDeg } from "@/lib/render/onboard-views";
import { SeatPanel } from "@/components/hud/SeatPanel";

const DEFAULT_ASSIST_PRESET: AssistPreset = DEFAULT_PLAYER_SETTINGS.assistPreset;
const vehicleLabel = (id: string) =>
  id === "f12026-car" ? tr("game.simulator.formulaTeamCars") : isVehicleModelId(id) ? carForVehicle(id).title : id;
const loadAllLocalLaps = () => listBestLaps().then((laps) => laps.map((lap) => lapToEntry(lap, "local")));
const trackNameOf = (id: string) => TRACKS.find((t) => t.id === id)?.name ?? id;
const noSubscribe = () => () => {};

installErrorLog();
const IDLE_PODIUM: PodiumUi = { stage: "idle", rows: [] };
const idlePodium = () => IDLE_PODIUM;

export interface LibreCorsaSimulatorProps {
  /** Active circuit (already set with `setActiveTrack`; the gate remounts this component on a change) */
  trackId?: string;
  /** Title menu circuit picker */
  /** Switches circuit: settles once the load lands (the scene remounts) or fails (the old circuit stays) */
  onSelectTrack?: (id: string) => void | Promise<void>;
  /** Mounts the circuit again from scratch (a new canvas and WebGL context), after the GPU context was lost */
  onRestart?: () => void;
}

export const LibreCorsaSimulator: React.FC<LibreCorsaSimulatorProps> = ({ trackId = DEFAULT_TRACK_ID, onSelectTrack, onRestart }) => {
  const tx = useTranslations("game.simulator");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nameplatesRef = useRef<OverheadNameplatesSink | null>(null);
  /** The drive on the mounted circuit: the scene, the car and the frame loop (created once the container exists) */
  const [session, setSession] = useState<DriveSession | null>(null);
  const sessionRef = useRef<DriveSession | null>(null);
  sessionRef.current = session;
  /** The browser gave this page no WebGL context: only a page reload (or a browser restart) can bring it back */
  const [webglRefused, setWebglRefused] = useState(false);

  const track = useMemo(() => getActiveTrackData(1200), []);
  /** The chosen car, and the vehicle model it drives on */
  const [carId, setCarId] = useState<CarId>(loadCarChoice);
  const carIdRef = useRef(carId);
  const [vehicleModel, setVehicleModel] = useState<VehicleModelId>(() => carPhysics(carId));
  const vehicleModelRef = useRef(vehicleModel);
  /** The kind of session on track (practice, an AI race or an online race), for the menus; the session sets it */
  const [raceKind, setRaceKind] = useState<SessionRace["kind"]>("practice");
  /** Track evolution and aero wake for every car on the circuit (the player's in every mode); an AI field shares it */
  const trackEnvRef = useRef<TrackEnvironment | null>(null);
  /**
   * The player's own conditions on this circuit: a night circuit starts at night until they pick a time of day
   * themselves (`resolveTimeOfDay`). Everything that reads their conditions reads these; the saved ones stay as picked
   */
  const trackTimeOfDay = useMemo(() => trackDefaultTimeOfDay(trackId), [trackId]);
  const ownConditionsNow = useCallback(
    () => resolveTimeOfDay(settingsRef.current.conditions, settingsRef.current.timeOfDayChosen, trackTimeOfDay),
    [trackTimeOfDay]
  );
  const getTrackEnv = useCallback(
    () => (trackEnvRef.current ??= new TrackEnvironment(track, ownConditionsNow())),
    [track, ownConditionsNow]
  );

  /** What the drive shows the UI (telemetry, replay bar, weather, the car's setup …): one subscription to the session */
  const [idleSnapshot] = useState(() => idleDriveSnapshot(track));
  const {
    telemetry,
    replay: replayUi,
    steerLockDeg,
    carCockpitFovDeg: carCockpitFov,
    virtualMirror: virtualMirrorOn,
    weather: weatherHud,
    assetsReady,
    p2pStatus,
    vr: vrState,
    muted,
    paused,
    pauseNotice,
    seatPanel,
    boostLatch,
    tireCompound,
    tyreSetup,
    defaultTyreSetup,
    chassisSetup,
    timeTrial,
    autoQualityLowered,
    qualityNotice,
    gpuLost,
    nowPlaying,
    cameraOverride,
    replayAvailable,
  } = useSyncExternalStore(session?.subscribe ?? noSubscribe, session?.getSnapshot ?? (() => idleSnapshot), () => idleSnapshot);

  const [aeroPreset, setAeroPreset] =
    useState<AeroSetupPreset>(DEFAULT_AERO_PRESET);
  const [gamepadRumble, setGamepadRumble] = useState<boolean>(loadRumble);
  useEffect(() => {
    session?.setRumble(gamepadRumble);
  }, [session, gamepadRumble]);

  const [phase, setPhaseState] = useState<AppPhase>("loading");
  const phaseRef = useRef<AppPhase>("loading");
  const setPhase = useCallback(
    (next: AppPhase) => {
      phaseRef.current = next;
      setPhaseState(next);
      session?.setPhase(next);
    },
    [session]
  );
  // The session takes the phase on once it exists too (setPhase above tells it of every change at once)
  useEffect(() => {
    session?.setPhase(phaseRef.current);
  }, [session]);
  /** The loading screen stays mounted while it fades out over the title menu */
  const [loadingVisible, setLoadingVisible] = useState(true);
  const [settings, setSettings] = useState<PlayerSettings>(DEFAULT_PLAYER_SETTINGS);
  // Key names in hints follow the keyboard layout (AZERTY's KeyW is "Z"): re-render once it is read
  useKeyLayout();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // The preferences the game applies to the car and the camera: `settings` is their only copy
  const assistPreset = settings.assistPreset;
  const showRacingLine = settings.racingLine;
  const gamepadAssist = settings.gamepadAssist;
  const autoGearbox = settings.autoGearbox;
  const mouseSteerEnabled = settings.mouseSteer;
  const selectedLivery = useMemo(
    () => resolveLivery(settings.liveryId, settings.customLivery),
    [settings.liveryId, settings.customLivery]
  );
  const cameraMode: CameraMode = settings.camera ?? "chase";
  const activeCameraMode: CameraMode = cameraOverride ?? cameraMode;
  const setPreference = useCallback(<K extends keyof PlayerSettings>(key: K, value: PlayerSettings[K]) => {
    setSettings((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);
  const setCameraMode = useCallback((mode: CameraMode) => {
    if (mode === "free") {
      sessionRef.current?.setCameraOverride("free");
      return;
    }
    sessionRef.current?.setCameraOverride(null);
    setPreference("camera", mode);
  }, [setPreference]);
  const toggleFreeCamera = useCallback(() => {
    sessionRef.current?.toggleFreeCamera();
  }, []);
  const toggleTvCamera = useCallback(() => {
    sessionRef.current?.toggleTvCamera();
  }, []);
  // The session takes the settings on whenever they change, and once it exists (whichever comes first)
  useEffect(() => {
    session?.applySettings(settings);
  }, [session, settings]);
  /** Saved settings have been read and applied (saving before that would overwrite them with defaults) */
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [wizardMode, setWizardMode] = useState<WizardMode>("first-run");
  /** Where the controls setup returns to */
  const wizardReturnRef = useRef<"title" | "pause">("title");
  /** First-run setup started from "Race AI" rather than "Drive" */
  const pendingRaceRef = useRef(false);
  const [launchHint, setLaunchHint] = useState(false);

  /** The results card was closed for this race */
  const [resultsClosed, setResultsClosed] = useState(false);

  // ---- Laps, ghosts, local personal bests
  const [lapSummary, setLapSummary] = useState<{ summary: LapSummaryData; recording: LapRecording } | null>(null);
  const [sessionLaps, setSessionLaps] = useState<SessionLapEntry[]>([]);
  const [allTimeBestLap, setAllTimeBestLap] = useState<LapRecording | null>(null);
  const [latestLap, setLatestLap] = useState<LapRecording | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const trackTurns = useMemo(() => [...TURN_METADATA], [track]);
  const trackSectorSplitsM = useMemo(
    () => sectorSplitsFromSamples(track.samples, track.pointToPoint?.finishS ?? track.totalLengthM),
    [track],
  );
  const ghostSourceRef = useRef<"pb" | "other">("pb");
  /** Bumped by every ghost choice, so a slower PB load cannot replace a ghost picked after it started */
  const ghostReqRef = useRef(0);
  /** Bumped by every leaderboard refresh; only the latest one updates the panel */
  const leaderboardReqRef = useRef(0);
  /** This car's best laps on this circuit, saved in this browser */
  const [localLaps, setLocalLaps] = useState<LeaderboardEntry[]>([]);

  // ---- VR, FFB meter
  const [vrSupported, setVrSupported] = useState(false);
  const [ffbMeter, setFfbMeter] = useState(wheelFfb.meter);
  const [touchVisible, setTouchVisible] = useState(false);

  /** The next view in the camera cycle, from the key, the pad, the touch pads and the menus alike */
  const cycleCamera = useCallback(() => {
    const snap = sessionRef.current?.getSnapshot();
    if (snap?.replay.active) {
      // Replay camera cycling is transient and never overwrites the player's saved driving camera
      const cur = snap.cameraOverride ?? settingsRef.current.camera ?? "chase";
      sessionRef.current?.setCameraOverride(cur === "free" ? (settingsRef.current.camera ?? "chase") : nextCameraMode(cur));
      return;
    }
    if (snap && snap.cameraOverride !== null) {
      sessionRef.current?.setCameraOverride(null);
      return;
    }
    setSettings((prev) => ({ ...prev, camera: nextCameraMode(prev.camera ?? "chase") }));
  }, []);

  // ---- Session and run: the one place that starts, restarts and leaves what is on track (the session resets the run)
  /** When replay was launched from RaceResults, exiting replay restores the results overlay */
  const returnToResultsRef = useRef(false);
  const prevReplayActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = prevReplayActiveRef.current;
    prevReplayActiveRef.current = replayUi.active;
    if (wasActive && !replayUi.active && returnToResultsRef.current) {
      returnToResultsRef.current = false;
      setResultsClosed(false);
    }
  }, [replayUi.active]);
  const handleWatchRaceReplay = useCallback(() => {
    if (!sessionRef.current) return;
    if (sessionRef.current.openReplay({ fromStart: true, play: true })) {
      returnToResultsRef.current = true;
      setResultsClosed(true);
    }
  }, []);
  const handleOpenPauseReplay = useCallback(() => {
    const sess = sessionRef.current;
    if (!sess) return;
    // If already watching a replay, unpausing returns to the exact scrubbed position instead of resetting to the end
    if (sess.getSnapshot().replay.active) return;
    sess.openReplay({ fromStart: false, play: false });
  }, []);
  /** A new run re-opens the race results card */
  const onRunReset = useCallback(() => {
    returnToResultsRef.current = false;
    setResultsClosed(false);
  }, []);

  const clearSessionState = useCallback(() => {
    setLapSummary(null);
    setLaunchHint(false);
    session?.endPause();
    session?.setBoostLatch(false);
  }, [session]);

  /**
   * A session starts on track: practice, a race against the AI field, or a multiplayer race. The caller places the
   * car (and starts the field) afterwards.
   */
  const startSession = useCallback(
    (race: SessionRace) => {
      session?.resetRun("session");
      session?.setRace(race);
      // A fresh session on a fresh track: baseline rubber, no marbles, the weather from its start (an AI race's start
      // and restarts reset it again, as the field always has)
      getTrackEnv().reset();
      clearSessionState();
      setPhase("driving");
    },
    [session, getTrackEnv, clearSessionState, setPhase]
  );

  /** Leaves the car for the title menu, resetting the car back to the grid */
  const leaveSession = useCallback(() => {
    session?.resetRun("session");
    session?.setRace({ kind: "practice" });
    clearSessionState();
    session?.car.resetToStartGrid(false);
    setPhase("title");
  }, [session, clearSessionState, setPhase]);


  const handleAeroPresetChange = useCallback((preset: AeroSetupPreset) => {
    setAeroPreset(preset);
    if (session) session.car.aeroPreset = preset;
  }, [session]);

  // The preferences only change the settings: the session applies them to the car and the scene
  const handleAssistPresetChange = useCallback((preset: AssistPreset) => setPreference("assistPreset", preset), [setPreference]);

  const handleToggleGamepadAssist = useCallback(() => {
    setSettings((prev) => ({ ...prev, gamepadAssist: !prev.gamepadAssist }));
  }, []);

  const handleToggleGamepadRumble = useCallback(() => {
    const next = !gamepadRumble;
    setGamepadRumble(next);
    saveRumble(next);
  }, [gamepadRumble]);

  const handleTireCompoundChange = useCallback((compound: TireCompound) => session?.setTireCompound(compound), [session]);

  const handleChangeTyreSetup = useCallback((next: TyreSetup) => {
    session?.setTyreSetup(next);
    saveTyreSetup(vehicleModelRef.current, next);
  }, [session]);

  const handleChangeChassisSetup = useCallback((next: ChassisSetup) => {
    session?.setChassisSetup(next);
    saveChassisSetup(vehicleModelRef.current, next);
  }, [session]);

  /** Swaps the player's car (the run starts over with it); the player's own pick goes through handleChangeCar */
  const changeCar = useCallback(
    (next: CarId) => {
      session?.unlockAudio();
      if (next === carIdRef.current) return;
      carIdRef.current = next;
      setCarId(next);
      vehicleModelRef.current = carPhysics(next);
      setVehicleModel(vehicleModelRef.current);
      setSetupBoardNotice(null);
      saveCarChoice(next);
      session?.setCar(next);
    },
    [session]
  );
  /** The car picker: the car is fixed for a multiplayer race (its start picks one the class allows) */
  const handleChangeCar = useCallback(
    (next: CarId) => {
      if (session?.race.kind === "mp") return;
      changeCar(next);
    },
    [session, changeCar]
  );

  // The car picker's physics switch: a ported F1 car moves onto the other vehicle model, in place (body kept)
  useEffect(
    () =>
      subscribeF1ModPhysics(() => {
        const car = carIdRef.current;
        if (!carTakesPhysicsSwitch(car)) return;
        const vehicle = carPhysics(car);
        if (vehicle === vehicleModelRef.current) return;
        vehicleModelRef.current = vehicle;
        setVehicleModel(vehicle);
        session?.setCar(car);
      }),
    [session]
  );

  const handleLiveryChange = useCallback((livery: LiveryConfig) => {
    if (livery.id === "custom") {
      setSettings((prev) => ({
        ...prev,
        liveryId: "custom",
        // Keep the user's saved custom colours when switching back to Custom from a preset;
        // overwrite them only while editing the colour pickers on Custom.
        customLivery:
          prev.liveryId === "custom"
            ? { primary: livery.primary, secondary: livery.secondary, accent: livery.accent }
            : prev.customLivery,
      }));
      return;
    }
    setPreference("liveryId", livery.id);
  }, [setPreference]);

  const handleToggleRacingLine = useCallback(() => {
    setSettings((prev) => ({ ...prev, racingLine: !prev.racingLine }));
  }, []);

  const handleToggleMute = useCallback(() => session?.toggleMute(), [session]);
  // The music alone: a press also unlocks the audio, so the first press on a silent menu starts the music
  const handleToggleMusicMute = useCallback(() => {
    session?.unlockAudio();
    setSettings((prev) => ({ ...prev, audio: { ...prev.audio, musicMuted: !prev.audio.musicMuted } }));
  }, [session]);

  const handleToggleAiAutopilot = useCallback(() => {
    session?.unlockAudio();
    session?.toggleAutopilot();
  }, [session]);

  // The on-screen aero button sends the same input as the key, pad and touch button (the car toggles on it)
  const handleToggleXMode = useCallback(() => {
    session?.unlockAudio();
    session?.runAction("aero");
  }, [session]);

  const handleToggleBoostLatch = useCallback(() => {
    session?.unlockAudio();
    session?.runAction("boostLatch");
  }, [session]);

  const handleOvertake = useCallback(() => {
    session?.unlockAudio();
    session?.runAction("overtake");
  }, [session]);

  const handleChangeLiveTuner = useCallback((patch: LiveTunerPatch) => session?.setLiveTuner(patch), [session]);

  const handleToggleMouseSteer = useCallback(() => {
    session?.unlockAudio();
    setSettings((prev) => ({ ...prev, mouseSteer: !prev.mouseSteer }));
  }, [session]);

  const handleResetCar = useCallback(
    (flyingStart: boolean) => {
      session?.unlockAudio();
      if (!session) return;
      const race = session.race;
      if (race.kind === "practice" && flyingStart) return session.restartFlyingLap();
      const physics = session.car;
      session.resetRun("restart");
      if (race.kind === "ai") startAiRace(race.field, settingsRef.current.race, settingsRef.current.profile, flyingStart ? false : undefined);
      else physics.resetToStartGrid(flyingStart);
    },
    [session]
  );

  const handleToggleAiOpponents = useCallback(() => {
    session?.unlockAudio();
    if (!session || getActivePointToPoint()) return;
    session.resetRun("race");
    if (session.race.kind === "ai") {
      session.setRace({ kind: "practice" });
      return;
    }
    const field = session.takeAiField();
    session.setRace({ kind: "ai", field });
    startAiRace(field, settingsRef.current.race, settingsRef.current.profile);
  }, [session]);

  const handleSelectTurn = useCallback(
    (turnNumber: number) => {
      session?.unlockAudio();
      if (!session) return;
      session.resetRun("teleport");
      if (session.race.kind === "ai") session.setRace({ kind: "practice" });
      session.car.teleportToTurn(turnNumber);
    },
    [session]
  );

  /** Esc / pad Menu: open or close the pause menu, releasing every held key */
  const togglePause = useCallback(() => session?.togglePause(), [session]);

  const setRacingLineVisible = useCallback((visible: boolean) => setPreference("racingLine", visible), [setPreference]);
  const setGamepadAssistEnabled = useCallback((enabled: boolean) => setPreference("gamepadAssist", enabled), [setPreference]);
  const setAutoGearbox = useCallback((enabled: boolean) => setPreference("autoGearbox", enabled), [setPreference]);
  const setMouseSteer = useCallback((enabled: boolean) => setPreference("mouseSteer", enabled), [setPreference]);

  const handleChangeSettings = useCallback((update: (prev: PlayerSettings) => PlayerSettings) => {
    setSettings((prev) => update(prev));
  }, []);

  /** Car and circuit browsers: stars, saved with the settings */
  const handleToggleFavorite = useCallback((kind: LibraryKind, ids: readonly string[]) => {
    setSettings((prev) => ({ ...prev, library: toggleLibraryFavorite(prev.library, kind, ids) }));
  }, []);
  const library = useMemo(() => ({ library: settings.library, onToggleFavorite: handleToggleFavorite }), [settings.library, handleToggleFavorite]);

  /** AI opponents' level: saved, and a running field drives to it at once */
  const handleChangeAiSkill = useCallback((aiSkill: number) => {
    setSettings((prev) => ({ ...prev, aiSkill }));
    if (session) aiFieldOf(session.race)?.setSkill(aiSkill);
  }, [session]);

  /**
   * The race setup: saved, and used from the next start. The session builds a field of the new size, and restarts a
   * race running from the lights with it
   */
  const handleChangeRaceSetup = useCallback((patch: Partial<RaceSetup>) => {
    setSettings((prev) => ({ ...prev, race: { ...prev.race, ...patch } }));
  }, []);

  /** Weather and time of day: saved, and the session on track switches to them (the weather starts over) */
  const handleChangeConditions = useCallback((conditions: SessionConditions) => {
    // The panel shows the circuit's own time of day until the player picks one: only that pick is saved as theirs
    setSettings((prev) => ({
      ...prev,
      ...applyConditionsChoice(
        prev.conditions,
        prev.timeOfDayChosen,
        resolveTimeOfDay(prev.conditions, prev.timeOfDayChosen, trackTimeOfDay),
        conditions,
        trackTimeOfDay
      ),
    }));
  }, [trackTimeOfDay]);
  /** Simulation realism: saved, and every car on track takes it on its next step */
  const handleChangeRealism = useCallback((realism: SimRealism) => {
    setSettings((prev) => ({ ...prev, realism }));
  }, []);
  const ownConditions = useMemo(
    () => resolveTimeOfDay(settings.conditions, settings.timeOfDayChosen, trackTimeOfDay),
    [settings.conditions, settings.timeOfDayChosen, trackTimeOfDay]
  );
  const activeConditionsRef = useRef(ownConditions);
  activeConditionsRef.current = ownConditions;
  const conditionsKey = JSON.stringify(ownConditions);
  useEffect(() => {
    const env = getTrackEnv();
    const next = activeConditionsRef.current;
    if (JSON.stringify(env.weather.conditions) !== JSON.stringify(next)) {
      env.setConditions(next);
      const car = session?.car;
      const autoCompound = autoCompoundFor(env.weather.lineWaterMm, car?.tireCompound);
      if (car && car.tireCompound !== autoCompound) handleTireCompoundChange(autoCompound);
    }
  }, [conditionsKey, getTrackEnv, session, handleTireCompoundChange]);
  useEffect(() => {
    getTrackEnv().setSimRealism(SIM_REALISM_FLAGS[settings.realism]);
  }, [settings.realism, getTrackEnv]);

  const handleOffTrackGlow = useCallback((on: boolean) => session?.setOffTrackGlow(on), [session]);

  /** null returns to the car's own FOV */
  const handleCockpitFovChange = useCallback((fovDeg: number | null) => {
    setSettings((prev) => ({ ...prev, cockpitFovDeg: fovDeg === null ? null : Math.round(clampFov(fovDeg)) }));
  }, []);

  /** The seat panel's view: the one on screen (the panel switches to the cockpit from any other) */
  const seatView: NudgeView = isNudgeView(cameraMode) ? cameraMode : "cockpit";
  /** The seat panel: moves that view for the car being driven a step, or puts it back where the car puts it */
  const handleSeatStep = useCallback(
    (step: Partial<CameraNudge> | null) => {
      setSettings((prev) => ({ ...prev, cameraNudges: stepNudge(prev.cameraNudges, carId, seatView, step) }));
    },
    [carId, seatView]
  );

  /** Leaves the menus for the car: a practice run from the grid, or a race against the AI field */
  const startDriving = useCallback(
    (race: boolean) => {
      // A hill climb has no races: one car at a time, start to finish
      if (getActivePointToPoint()) race = false;
      const field = race && session ? (aiFieldOf(session.race) ?? session.takeAiField()) : null;
      // Qualifying first when the race setup asks for it: the player alone on a flying lap, the field waiting
      const qualifyingMin = settingsRef.current.race.qualifying;
      startSession(field && !qualifyingMin ? { kind: "ai", field } : { kind: "practice" });
      if (field && qualifyingMin) session?.startQualifying(field, qualifyingMin);
      else if (field) startAiRace(field, settingsRef.current.race, settingsRef.current.profile);
      else session?.car.resetToStartGrid(false);
      setLaunchHint(true);
    },
    [session, startSession]
  );

  // In the menus (after loading, after a race): have the next race's AI field ready (a car swap asks for its own).
  // Not before the loading screen has gone: the press that leaves it shows the menus first
  useEffect(() => {
    if (phase === "loading" || phase === "driving" || !assetsReady || loadingVisible) return;
    session?.prepareAiField();
  }, [session, phase, assetsReady, loadingVisible]);

  // ---- Laps, ghosts, local leaderboards
  /** The board for what the player drives with now: their assists and realism, today's surface, this physics revision */
  const currentBoard = useCallback(
    (): LapConditions =>
      lapConditionsNow({
        assists: session?.car.assistPreset ?? DEFAULT_ASSIST_PRESET,
        compound: session?.car.tireCompound ?? "soft",
        lineWaterMm: getTrackEnv().weather.lineWaterMm,
        realism: settingsRef.current.realism,
        vehicle: vehicleModelRef.current,
        trackId,
      }),
    [session, getTrackEnv, trackId]
  );
  const refreshLeaderboard = useCallback(async () => {
    // Several refreshes can overlap (car change, a saved lap): only the latest may land
    const req = ++leaderboardReqRef.current;
    const vehicleNow = vehicleModelRef.current;
    const [local, all] = await Promise.all([
      localLeaderboard(trackId, vehicleNow).catch((): LeaderboardEntry[] => []),
      listBestLaps().catch((): LapRecording[] => []),
    ]);
    if (req !== leaderboardReqRef.current) return;
    setLocalLaps(local);
    setAllTimeBestLap(selectCarBestLap(all, trackId, vehicleNow));
  }, [trackId]);

  /** Races the personal best of this car as the ghost, replacing whichever lap was chosen */
  const loadPbGhost = useCallback(async () => {
    // A ghost picked (or another car's PB requested) while this one loads wins over it
    const req = ++ghostReqRef.current;
    // The best on the board the player is driving now (an assisted best is not their pro reference)
    const rec = await loadBestLap(trackId, vehicleModelRef.current, lapBoardClass(currentBoard())).catch(() => null);
    if (req !== ghostReqRef.current) return;
    ghostSourceRef.current = "pb";
    // A best from an earlier version of the circuit is moved onto this one
    session?.setGhost(rec ? new GhostPlayer(alignGhostToTrack(rec, track).recording) : null);
    session?.lapRecorder.setContext({ personalBestMs: rec?.lapTimeMs ?? null });
  }, [session, trackId, currentBoard, track]);

  useEffect(() => {
    let cancelled = false;
    setSessionLaps([]);
    setAnalysisOpen(false);
    void loadLatestLap(trackId, vehicleModel)
      .then((rec) => {
        if (!cancelled) setLatestLap(rec);
      })
      .catch(() => {
        if (!cancelled) setLatestLap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [trackId, vehicleModel]);

  const onLapCompleted = useCallback(
    (summary: LapSummaryData, recording: LapRecording) => {
      if (recording.data.length > 0) {
        // The driver's totals (driver-stats.ts): the lap's distance
        recordLapDistance(recording.trackLengthM ?? 0);
        const valid = summary.valid && !summary.autopilot;
        setSessionLaps((prev) => [{ recording, valid, lapNumber: summary.lapNumber }, ...prev].slice(0, 20));
        setLatestLap(recording);
        if (valid) {
          setAllTimeBestLap((prev) => (!prev || recording.lapTimeMs < prev.lapTimeMs ? recording : prev));
        }
        void saveLatestLap(recording);
      }
      if (settingsRef.current.hud.lapSummary) {
        setLapSummary({ summary, recording });
      }
      if (!summary.valid || summary.autopilot) return;
      const ghostReq = ghostReqRef.current;
      void saveBestLapIfFaster(recording)
        .then((saved) => {
          if (saved) {
            if (ghostSourceRef.current === "pb" && ghostReq === ghostReqRef.current && recording.vehicle === vehicleModelRef.current) {
              ghostReqRef.current++;
              session?.setGhost(new GhostPlayer(recording));
            }
            void refreshLeaderboard();
          }
        })
        .catch(() => {});
    },
    [session, refreshLeaderboard]
  );
  useEffect(() => session?.onLapCompleted(onLapCompleted), [session, onLapCompleted]);

  /** Local driver rename: validates and updates local profile immediately with zero network calls */
  const renameDriver = useCallback(async (raw: string): Promise<{ error: string } | { name: string; code: string }> => {
    const name = sanitizeDriverName(raw);
    const prev = settingsRef.current.profile;
    if (name === prev.name) return { name, code: prev.code };
    const problem = nameProblem(name);
    if (problem) return { error: problem };
    const code = prev.generated ? codeFromName(name) : prev.code;
    setSettings((s) => ({ ...s, profile: { ...s.profile, name, code, generated: false } }));
    return { name, code };
  }, []);
  const renameFromSettings = useCallback(async (raw: string) => {
    const res = await renameDriver(raw);
    return "error" in res ? res.error : null;
  }, [renameDriver]);

  const closeLapSummary = useCallback(() => {
    setLapSummary(null);
  }, []);

  /** Uses a lap from the leaderboard (or a file) as the ghost */
  const raceGhost = useCallback((rec: LapRecording | null) => {
    if (!rec) return;
    ghostReqRef.current++;
    // A lap from another version of the circuit (a downloaded or older file) is moved onto this one
    session?.setGhost(new GhostPlayer(alignGhostToTrack(rec, track).recording));
    ghostSourceRef.current = "other";
    setSettings((prev) => (prev.ghost ? prev : { ...prev, ghost: true }));
  }, [session, track]);

  const [setupBoardNotice, setSetupBoardNotice] = useState<{ text: string; vehicle: VehicleModelId; undo?: () => void } | null>(null);
  useEffect(() => {
    setSetupBoardNotice(null);
  }, [trackId, vehicleModel, session]);
  const handleApplyLeaderboardSetup = useCallback(
    async (entry: LeaderboardEntry) => {
      const targetVehicle = vehicleModelRef.current;
      const startSession = sessionRef.current;
      let rec = null;
      if (!entry.setup) {
        rec = await loadBestLap(entry.trackId, entry.vehicle, entry.conditions ? lapBoardClass(entry.conditions) : null).catch(() => null);
      }
      // Drop stale result if the player switched cars or sessions while loading
      if (vehicleModelRef.current !== targetVehicle || sessionRef.current !== startSession) return;
      const setup = entry.setup ?? rec?.setup ?? null;
      if (!setup) {
        setSetupBoardNotice({
          text: tx("setupMissing", { driver: entry.name }),
          vehicle: targetVehicle,
        });
        return;
      }
      const snap = sessionRef.current?.getSnapshot();
      const prevChassis = snap?.chassisSetup ?? chassisSetup;
      const prevTyre = snap?.tyreSetup ?? tyreSetup;
      const prevCompound = snap?.tireCompound ?? tireCompound;
      const prevAero = aeroPreset;
      const prevTuner = garageTunerFrom(snap?.telemetry.liveTuner ?? telemetry.liveTuner);
      const resolved = resolveSetupForCar(
        setup,
        targetVehicle,
        prevTyre,
        (t) => clampTyreSetup(targetVehicle, t),
        prevCompound,
        prevAero,
        prevTuner,
        prevChassis.fuelDeltaKg,
      );
      const keepChallengeCompound = snap?.timeTrial?.vehicle === targetVehicle;
      handleChangeChassisSetup(resolved.chassis);
      handleChangeTyreSetup(resolved.tyre);
      if (!keepChallengeCompound) handleTireCompoundChange(resolved.compound);
      handleAeroPresetChange(resolved.aero);
      handleChangeLiveTuner(resolved.tuner);
      setSetupBoardNotice({
        text: tx("setupApplied", { driver: entry.name, summary: summarizeSharedSetup(setup) }),
        vehicle: targetVehicle,
        undo: () => {
          if (vehicleModelRef.current !== targetVehicle || sessionRef.current !== startSession) return;
          handleChangeChassisSetup(prevChassis);
          handleChangeTyreSetup(prevTyre);
          if (!keepChallengeCompound) handleTireCompoundChange(prevCompound);
          handleAeroPresetChange(prevAero);
          handleChangeLiveTuner(prevTuner);
        },
      });
    },
    [
      aeroPreset,
      chassisSetup,
      defaultTyreSetup,
      handleAeroPresetChange,
      handleChangeChassisSetup,
      handleChangeLiveTuner,
      handleChangeTyreSetup,
      handleTireCompoundChange,
      telemetry.liveTuner,
      tireCompound,
      tx,
      tyreSetup,
    ],
  );

  const handleRaceGhostEntry = useCallback(
    async (entry: LeaderboardEntry) => {
      const rec = await loadBestLap(entry.trackId, entry.vehicle, entry.conditions ? lapBoardClass(entry.conditions) : null).catch(() => null);
      raceGhost(rec);
    },
    [raceGhost]
  );

  const handleImportGhost = useCallback(
    async (file: File) => {
      const rec = await importLapFile(file).catch(() => null);
      if (rec && rec.trackId === trackId) raceGhost(rec);
    },
    [raceGhost, trackId]
  );

  const handleExportBest = useCallback(async () => {
    const rec = await loadBestLap(trackId, vehicleModelRef.current, lapBoardClass(currentBoard())).catch(() => null);
    if (rec) exportLapFile(rec);
  }, [trackId, currentBoard]);

  // ---- Wheel force meter
  const handleApplySuggestedGain = useCallback(() => {
    const gain = wheelFfb.meter.suggestedGain;
    if (gain === null) return;
    const vehicle = vehicleModelRef.current;
    setSettings((prev) => ({
      ...prev,
      wheel: {
        ...prev.wheel,
        ffbPerCar: {
          ...prev.wheel.ffbPerCar,
          [vehicle]: { gain, minForce: prev.wheel.ffbPerCar?.[vehicle]?.minForce ?? prev.wheel.ffbMinForce },
        },
      },
    }));
    wheelFfb.resetMeter();
  }, []);

  /** The Settings screen, over the title menu or the pause menu, and where it opens */
  const [settingsOpen, setSettingsOpen] = useState<{ from: "title" | "pause"; category?: SettingsCategory; tab?: string } | null>(null);
  // Settings > Display > HUD > Edit layout: the live HUD's layout editor stands in for Settings until Done or Cancel
  const [hudEditing, setHudEditing] = useState(false);
  useEffect(() => {
    if (phase !== "title" && phase !== "driving") setHudEditing(false);
  }, [phase]);
  const openSettings = useCallback(
    (from: "title" | "pause", category?: SettingsCategory, tab?: string) => {
      // Opened from the car (the HUD's "pedals not set up"): the session pauses under it, as from the pause menu
      if (from === "pause" && !session?.getSnapshot().paused) session?.togglePause();
      setSettingsOpen({ from, category, tab });
    },
    [session]
  );
  const closeSettings = useCallback(() => setSettingsOpen(null), []);
  // Every way out of the pause (the touch pause button, a wheel's pause button, a race restart) closes it too
  const wasPausedRef = useRef(paused);
  useEffect(() => {
    const resumed = wasPausedRef.current && !paused;
    wasPausedRef.current = paused;
    if (settingsOpen?.from === "pause" && (resumed || phase !== "driving")) setSettingsOpen(null);
    if (settingsOpen?.from === "title" && phase !== "title") setSettingsOpen(null);
  }, [settingsOpen, paused, phase]);

  /** First-run setup again, from Settings > Controls > Device: back where Settings was opened from when done */
  const runSetupAgain = useCallback(() => {
    const from = settingsOpen?.from ?? "title";
    setSettingsOpen(null);
    wizardReturnRef.current = from;
    setWizardMode("again");
    setPhase("wizard");
  }, [settingsOpen, setPhase]);

  /** Title "Drive" / "Race AI": the first time through, the setup comes first */
  const handleTitleStart = useCallback(
    (race: boolean) => {
      if (onboarded) {
        startDriving(race);
        return;
      }
      pendingRaceRef.current = race;
      wizardReturnRef.current = "title";
      setWizardMode("first-run");
      setPhase("wizard");
    },
    [onboarded, startDriving, setPhase]
  );

  const leaveWizard = useCallback(() => {
    // Setup run again from pause goes back to it (still paused)
    setPhase(wizardReturnRef.current === "pause" ? "driving" : "title");
  }, [setPhase]);

  const finishWizard = useCallback(() => {
    if (wizardMode === "first-run") {
      saveOnboarded();
      setOnboarded(true);
      startDriving(pendingRaceRef.current);
    } else {
      leaveWizard();
    }
  }, [wizardMode, startDriving, leaveWizard]);

  const handleWizardStep = useCallback((step: WizardStepId) => session?.setWizardStep(step), [session]);

  /** "Press any key" on the loading screen: the user gesture that unlocks audio */
  const handleLoadingStart = useCallback(() => {
    session?.unlockAudio();
    if (phaseRef.current !== "loading") return;
    setPhase("title");
  }, [session, setPhase]);
  const handleLoadingDone = useCallback(() => setLoadingVisible(false), []);

  // The first-drive hint clears once the car is moving (or after a while)
  useEffect(() => {
    if (!launchHint) return;
    const id = window.setTimeout(() => setLaunchHint(false), 15_000);
    return () => window.clearTimeout(id);
  }, [launchHint]);
  useEffect(() => {
    if (!launchHint || !session) return;
    if (session.getTelemetry().speedKmh > 15) {
      setLaunchHint(false);
      return;
    }
    return session.subscribeTelemetry(() => {
      if (session.getTelemetry().speedKmh > 15) setLaunchHint(false);
    });
  }, [launchHint, session]);
  // A car's first drive also names the seat panel in the launch hint; once it has shown (or the panel opened), not again
  const [seatHintOn, setSeatHintOn] = useState(false);
  const showsSeatHint = settings.device === "wheel" || settings.device === "controller";
  useEffect(() => {
    if (launchHint && showsSeatHint) {
      setSeatHintOn(!seatHintSeen(carId));
      return;
    }
    setSeatHintOn((on) => {
      if (on) markSeatHintSeen(carId);
      return false;
    });
  }, [launchHint, carId, showsSeatHint]);
  useEffect(() => {
    if (!seatPanel) return;
    markSeatHintSeen(carId);
    setSeatHintOn(false);
  }, [seatPanel, carId]);

  // Silence the pad rumble and FFB as soon as the pause menu opens or the car is left for the menus (the car audio
  // follows the frame loop, which pauses it on every frame the car is not driven, in every phase)
  useEffect(() => {
    const silence = paused || phase !== "driving";
    if (silence) session?.silenceFeedback();
  }, [session, paused, phase]);

  /**
   * The way back from a lost context: the circuit mounts again on a new canvas, with Low saved first when asked. A
   * browser that refuses WebGL to the page after a reset would only fail again: then the notice asks for a page reload.
   */
  const restartAfterGpuLoss = useCallback(
    (lower: boolean) => {
      if (probeRenderer() === null) {
        setWebglRefused(true);
        return;
      }
      // The player chose: the next start does not switch the preset by itself
      settleLoss(browserStore(), Date.now());
      const s = settingsRef.current;
      savePlayerSettings(lower ? { ...s, graphics: { ...s.graphics, quality: "low" } } : s);
      if (onRestart) onRestart();
      else window.location.reload();
    },
    [onRestart]
  );
  const gpuNoticeKind = webglRefused
    ? lostRecently()
      ? "blocked"
      : "unavailable"
    : gpuLost
      ? gpuLost.hidden
        ? "background"
        : "lost"
      : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let session: DriveSession;
    try {
      session = new DriveSession(container, {
        car: carIdRef.current,
        cycleCamera,
        getTrackEnv,
        handleToggleRacingLine,
        setSettings,
        setRaceKind,
        onRunReset,
        track,
        trackId,
        // The save itself, read here as well as below: the state still holds the prerendered defaults at this point
        settings: loadPlayerSettings(),
        nameplatesRef,
      });
    } catch (err) {
      // No WebGL for this page (switched off, or refused after a GPU reset): say so rather than the error screen
      if (!(err instanceof WebGLUnavailableError)) throw err;
      console.warn("[gpu]", err.message);
      setWebglRefused(true);
      return;
    }
    setSession(session);
    return () => {
      session.dispose();
      setSession(null);
    };
  }, [track, getTrackEnv, handleToggleRacingLine, onRunReset]);

  // Saved settings and the first-run flag are read after mount (the page is prerendered without storage); the
  // session takes the settings on through applySettings, whether it exists yet or not
  useEffect(() => {
    setSettings(loadPlayerSettings());
    setOnboarded(loadOnboarded());
    setSettingsHydrated(true);
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    savePlayerSettings(settings);
  }, [settingsHydrated, settings]);

  // Units, interface size and the colour-blind palette: once at start-up (the defaults, then the save) and on change
  useEffect(() => {
    applyInterfaceSettings(settings.ui);
  }, [settings.ui]);

  // Recently driven / raced, for the browsers: the car and circuit in use once the save is read, then every change
  useEffect(() => {
    if (!settingsHydrated) return;
    setSettings((prev) => {
      const next = pushLibraryRecent(pushLibraryRecent(prev.library, "cars", carId), "circuits", trackId);
      return next === prev.library ? prev : { ...prev, library: next };
    });
  }, [settingsHydrated, carId, trackId]);

  // Driver profile on the local lap recorder
  useEffect(() => {
    session?.lapRecorder.setContext({ driverName: settings.profile.name, driverCode: settings.profile.code });
  }, [session, settings.profile]);

  // A car change brings back that car's personal-best ghost and leaderboard
  useEffect(() => {
    void loadPbGhost();
    void refreshLeaderboard();
    wheelFfb.resetMeter();
  }, [vehicleModel, loadPbGhost, refreshLeaderboard]);

  const ffbMeterOn = phase === "driving" && settings.device === "wheel" && settings.wheel.ffbEnabled;
  useEffect(() => {
    if (!ffbMeterOn) return;
    const id = window.setInterval(() => setFfbMeter({ ...wheelFfb.meter }), 100);
    return () => window.clearInterval(id);
  }, [ffbMeterOn]);

  useEffect(() => {
    const mode = settings.touch.mode;
    const visible = mode === "on" || (mode === "auto" && isTouchDevice());
    setTouchVisible(visible);
    if (!visible) resetTouchInput();
  }, [settings.touch.mode]);

  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported?: (mode: string) => Promise<boolean> } }).xr;
    if (!xr?.isSessionSupported) return;
    xr.isSessionSupported("immersive-vr").then(setVrSupported, () => setVrSupported(false));
  }, []);

  // WebHID force feedback (HID PID wheels, listed Logitech wheels) instead of the bridge, while switched on. Only a
  // wheel granted before reopens here: pairing needs requestDevice inside a click, which the wheel setup's toggle /
  // Connect does.
  const hidFfbWanted = settings.wheel.ffbEnabled && settings.wheel.hidFfb;
  // Before the reconnect below: a classic Logitech wheel is set to this rotation as it connects
  useEffect(() => webHidFfb.setRotationDeg(settings.wheel.rotationDeg), [settings.wheel.rotationDeg]);
  // Also before it: friction / inertia switched on are set up with the wheel (a running one is set up again for them)
  const wantFriction = settings.wheel.ffbFriction > 0;
  const wantInertia = settings.wheel.ffbInertia > 0;
  useEffect(() => webHidFfb.setWantedConditions({ friction: wantFriction, inertia: wantInertia }), [wantFriction, wantInertia]);
  useEffect(() => {
    if (!hidFfbWanted) {
      void webHidFfb.dispose();
      return;
    }
    void webHidFfb.reconnect();
  }, [hidFfbWanted]);
  // A DualSense paired on an earlier visit opens again without a prompt (adaptive triggers, rumble, lights), and so
  // does a DualShock 4 connected for gyro steering
  useEffect(() => {
    void dualSenseHid.restore();
    void dualShock4Hid.restore();
  }, []);
  // A recognised wheel with no steering bound (the wizard's wheel step skipped, or plugged in later) is set up as a
  // wheel straight away; otherwise it drives as a gamepad, through the stick steering assist
  useEffect(() => {
    const bindWheel = () =>
      setSettings((prev) => {
        if (prev.wheel.steer) return prev;
        const patch = autoConfigureWheel(connectedPads(), prev.wheel);
        return patch ? { ...prev, wheel: { ...prev.wheel, ...patch } } : prev;
      });
    bindWheel();
    window.addEventListener("gamepadconnected", bindWheel);
    return () => window.removeEventListener("gamepadconnected", bindWheel);
  }, []);
  // A fatal driver error (unsupported wheel, failed setup, writes failing) switches WebHID off: the force goes back
  // to the bridge and the wheel setup shows the reason under the toggle
  useEffect(
    () =>
      webHidFfb.subscribe(() => {
        if (!isFatalHidStatus(webHidFfb.status)) return;
        setSettings((prev) => (prev.wheel.hidFfb ? { ...prev, wheel: { ...prev.wheel, hidFfb: false } } : prev));
      }),
    []
  );

  const keyNames = useMemo(() => {
    const first = (codes: string[]) => (codes[0] ? keyLabel(codes[0]) : "—");
    const k = settings.keys;
    return {
      camera: first(k.camera),
      freeCamera: first(k.freeCamera),
      tvCamera: first(k.tvCamera),
      racingLine: first(k.racingLine),
      mute: first(k.mute),
      mouseSteer: first(k.mouseSteer),
      autopilot: first(k.autopilot),
      restart: first(k.restart),
      shiftUp: first(k.shiftUp),
      shiftDown: first(k.shiftDown),
      board: first(k.board),
      headlights: first(k.headlights),
    };
  }, [settings.keys]);
  // With the touch pads up and no wheel or controller picked, the pads are what the player drives with
  const launchHintText =
    settings.device === "wheel"
      ? seatHintOn
        ? tx("launchWheelSeat")
        : tx("launchWheel")
      : settings.device === "controller"
        ? seatHintOn
          ? tx("launchPadSeat", { press: pressPedalText(settings.padTuning.pedalSources.throttle), button: padButtonLabel(settings.padButtons.camera) })
          : tx("launchPad", { press: pressPedalText(settings.padTuning.pedalSources.throttle) })
        : touchVisible && vrState !== "on"
          ? tx("launchTouch")
          : tx("launchKey", { key: keyLabel(settings.keys.throttle[0]) });

  // After the flag: podium shot and local race history
  const podiumUi = useSyncExternalStore(session?.podium.subscribe ?? noSubscribe, session?.podium.getSnapshot ?? idlePodium, idlePodium);
  const raceHistory = useRaceHistory(telemetry.race, telemetry.runId, {
    trackId,
    carId,
    kind: raceKind === "ai" ? "ai_race" : null,
  });

  // Track local driving time for the driver's stats
  const driveTime = useRef<{ pair: string; ms: number; since: number | null }>({ pair: "", ms: 0, since: null });
  useEffect(() => {
    const pair = `${trackId}|${carId}`;
    const d = driveTime.current;
    const now = performance.now();
    if (d.since !== null) {
      const sliceMs = now - d.since;
      d.ms += sliceMs;
      const [drivenTrack, drivenCar] = d.pair.split("|");
      recordDrivingTime(sliceMs / 1000, drivenCar || carId, drivenTrack || trackId);
    }
    d.since = phase === "driving" && !paused ? now : null;
    if (d.pair !== pair) {
      d.pair = pair;
      d.ms = 0;
    }
  }, [phase, paused, trackId, carId]);

  const telemetrySource = useMemo(
    () => (session ? { subscribe: session.subscribeTelemetry, getSnapshot: session.getTelemetry } : undefined),
    [session]
  );

  const menuProps = {
    telemetry,
    settings,
    onChangeSettings: handleChangeSettings,
    steerLockDeg,
    pauseNotice,
    aeroPreset,
    assistPreset,
    cameraMode: activeCameraMode,
    onSelectCamera: setCameraMode,
    onToggleFreeCamera: toggleFreeCamera,
    onToggleTvCamera: toggleTvCamera,
    tireCompound,
    selectedLivery,
    showRacingLine,
    isMuted: muted,
    mouseSteerEnabled,
    gamepadAssist,
    autoGearbox,
    onSetAutoGearbox: setAutoGearbox,
    gamepadRumble,
    aiOpponents: raceKind === "ai",
    onToggleAiOpponents: handleToggleAiOpponents,
    aiSkill: settings.aiSkill,
    onChangeAiSkill: handleChangeAiSkill,
    raceSetup: settings.race,
    onChangeRaceSetup: handleChangeRaceSetup,
    carId,
    vehicleModel,
    onChangeCar: handleChangeCar,
    onToggleGamepadAssist: handleToggleGamepadAssist,
    onToggleGamepadRumble: handleToggleGamepadRumble,
    onChangeAeroPreset: handleAeroPresetChange,
    onChangeAssistPreset: handleAssistPresetChange,
    onChangeTireCompound: handleTireCompoundChange,
    tyreSetup,
    defaultTyreSetup,
    onChangeTyreSetup: handleChangeTyreSetup,
    chassisSetup,
    onChangeChassisSetup: handleChangeChassisSetup,
    onChangeLiveTuner: handleChangeLiveTuner,
    onChangeLivery: handleLiveryChange,
    onToggleRacingLine: handleToggleRacingLine,
    onToggleMute: handleToggleMute,
    nowPlaying,
    onSkipTrack: session ? session.nextTrack : undefined,
    musicMuted: settings.audio.musicMuted,
    onToggleMusicMute: handleToggleMusicMute,
    onToggleAiAutopilot: handleToggleAiAutopilot,
    onToggleMouseSteer: handleToggleMouseSteer,
    onResetCar: handleResetCar,
    onSelectTurn: handleSelectTurn,
    onTogglePause: togglePause,
    perfReport: session?.perfReport ?? null,
    keyNames,
    profile: settings.profile,
    displayPanel: {
      settings,
      onChangeSettings: handleChangeSettings,
      vrSupported,
      vrActive: vrState === "on",
      onEnterVr: () => session?.enterVr(),
      onOpenSeatPanel: phase === "driving" ? () => session?.openSeatPanel() : undefined,
    },
    conditionsPanel: {
      conditions: ownConditions,
      trackTimeOfDay,
      realism: settings.realism,
      onChangeConditions: handleChangeConditions,
      onChangeRealism: handleChangeRealism,
      hostControlled: false,
      readout: weatherHud,
    },
    library,
    leaderboardPanel: {
      trackName: getTrackInfo(trackId).name,
      trackId,
      trackNameOf,
      loadAllLocal: loadAllLocalLaps,
      vehicleLabel,
      local: localLaps,
      sessionLaps,
      allTimeBestLap,
      latestLap,
      turns: trackTurns,
      sectorSplitsM: trackSectorSplitsM,
      vehicle: vehicleModel,
      onRaceGhost: (entry: LeaderboardEntry) => void handleRaceGhostEntry(entry),
      onApplySetup: handleApplyLeaderboardSetup,
      setupNotice: setupBoardNotice,
      onDismissSetupNotice: () => setSetupBoardNotice(null),
      onImportGhost: (file: File) => void handleImportGhost(file),
      onExportBest: () => void handleExportBest(),
    },
  };

  /** What the Settings screen reads and changes (the same rows first-run setup draws) */
  const settingsEnv: SettingsEnv = {
    settings,
    update: handleChangeSettings,
    rumble: gamepadRumble,
    onToggleRumble: handleToggleGamepadRumble,
    steerLockDeg,
    carId,
    vehicleModel,
    vehicleLabel,
    carFovDeg: carCockpitFov,
    vrSupported,
    vrActive: vrState === "on",
    onEnterVr: () => session?.enterVr(),
    autoQualityLowered,
    onRenameDriver: renameFromSettings,
    onOpenSeatPanel:
      phase === "driving"
        ? () => {
            setSettingsOpen(null);
            session?.openSeatPanel();
          }
        : undefined,
    // The live HUD's layout editor, over the title scene or the paused race: Settings comes back on its HUD tab after
    onEditHudLayout:
      phase === "title" || phase === "driving"
        ? () => {
            setSettingsOpen((open) => (open ? { ...open, category: "display", tab: "hud" } : open));
            setHudEditing(true);
          }
        : undefined,
    onRunSetup: runSetupAgain,
  };

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-lc-void supports-[height:100dvh]:h-dvh"
      onPointerDown={() => {
        // Not for a press on the GPU notice: that session is about to go, and a sound bank loading then lands on its
        // closed audio context
        if (phaseRef.current !== "loading" && !gpuNoticeKind) session?.unlockAudio();
      }}
    >
      <div ref={containerRef} className="h-full w-full" />
      <OverheadNameplates overlayRef={nameplatesRef} />

      {phase === "driving" && seatPanel ? (
        <SeatPanel
          carTitle={carById(carId).title}
          view={seatView}
          nudge={nudgeOf(settings.cameraNudges, carId, seatView)}
          fovDeg={clampFov(
            (seatView === "dash" ? dashViewFovDeg(carId) : carCockpitFov) +
              (settings.cockpitFovDeg === null ? 0 : settings.cockpitFovDeg - carCockpitFov) +
              nudgeOf(settings.cameraNudges, carId, seatView).fovDeg
          )}
          onStep={handleSeatStep}
          onSetView={setCameraMode}
          onClose={() => session?.closeSeatPanel()}
          cameraKeys={settings.keys.camera}
          cameraButton={settings.padButtons.camera}
        />
      ) : null}

      {phase === "driving" || hudEditing ? (
        <F1TelemetryHud
          {...menuProps}
          telemetrySource={telemetrySource}
          hudEditor={hudEditing ? { onClose: () => setHudEditing(false) } : null}
          seatPanel={seatPanel}
          track={track}
          weather={weatherHud}
          boostLatch={boostLatch}
          qualityNotice={qualityNotice}
          showLaunchHint={launchHint}
          launchHintText={launchHintText}
          hudToggleButton={settings.padButtons.hud === null ? undefined : padButtonLabel(settings.padButtons.hud)}
          wheelUncalibrated={
            settings.device === "wheel" && (!settings.wheel.throttle || !settings.wheel.brake)
          }
          onCycleCamera={cycleCamera}
          onOffTrackGlow={handleOffTrackGlow}
          cockpitFovDeg={settings.cockpitFovDeg}
          cockpitFovDefaultDeg={carCockpitFov}
          onChangeCockpitFov={handleCockpitFovChange}
          onToggleXMode={handleToggleXMode}
          onToggleBoostLatch={handleToggleBoostLatch}
          onOvertake={handleOvertake}
          onChangeLiveTuner={handleChangeLiveTuner}
          paused={paused}
          pauseMenuCovered={settingsOpen?.from === "pause"}
          onOpenControls={() =>
            // A wheel whose pedals are not set up yet opens on its calibration (the HUD's "pedals not set up" too)
            settings.device === "wheel" && (!settings.wheel.throttle || !settings.wheel.brake)
              ? openSettings("pause", "controls", "wheel")
              : openSettings("pause")
          }
          onExitToTitle={leaveSession}
          onOpenSettings={(category?: SettingsCategory, tab?: string) => openSettings("pause", category, tab)}
          hud={settings.hud}
          virtualMirror={virtualMirrorOn}
          ffbMeter={
            ffbMeterOn
              ? {
                  force: ffbMeter.force,
                  clipping: ffbMeter.clipping,
                  peak: ffbMeter.peak,
                  suggestedGain: ffbMeter.suggestedGain,
                  onApplySuggestedGain: handleApplySuggestedGain,
                }
              : null
          }
          lapSummary={
            lapSummary
              ? {
                  summary: lapSummary.summary,
                  onClose: closeLapSummary,
                  onSaveGhost: () => exportLapFile(lapSummary.recording),
                  onAnalyze: sessionLaps.length > 0 || allTimeBestLap || latestLap ? () => setAnalysisOpen(true) : undefined,
                  driverName: settings.profile.name,
                }
              : null
          }
          resultsClosed={resultsClosed}
          onCloseResults={() => setResultsClosed(true)}
          onRestartRace={() => handleResetCar(false)}
          raceEnd={{
            podium: podiumUi,
            onSkipPodium: () => session?.podium.skip(),
            history: raceHistory,
          }}
          onWatchReplay={replayAvailable ? handleWatchRaceReplay : undefined}
          onOpenReplay={replayAvailable ? handleOpenPauseReplay : undefined}
          replay={
            replayUi.active
              ? {
                  timeS: replayUi.timeS,
                  startS: replayUi.startS,
                  endS: replayUi.endS,
                  playing: replayUi.playing,
                  speed: replayUi.speed,
                  cameraMode: activeCameraMode,
                  cameraLabel: CAMERA_MODES[activeCameraMode].label,
                  focusedCarId: replayUi.focusedCarId,
                  cars: replayUi.cars,
                  lapMarkers: replayUi.lapMarkers,
                  onTogglePlay: () => session?.replayTogglePlay(),
                  onSeek: (timeS: number) => session?.replaySeek(timeS),
                  onSpeed: (speed: number) => session?.replaySpeed(speed),
                  onStepFrame: (dir: 1 | -1) => session?.replayStepFrame(dir),
                  onSelectCamera: (mode: CameraMode) => session?.setCameraOverride(mode),
                  onCycleCamera: cycleCamera,
                  onCycleCar: replayUi.cars.length > 1 ? (dir: 1 | -1) => session?.replayCycleCar(dir) : undefined,
                  onExit: () => session?.exitReplay(),
                  onFlashback: replayUi.canFlashback ? () => { session?.flashbackReplay(); } : undefined,
                  exitKeyLabel: settings.keys.replay[0] ? keyLabel(settings.keys.replay[0]) : "T",
                }
              : null
          }
          touchControls={
            touchVisible && vrState !== "on"
              ? {
                  layout: settings.touch.layout,
                  tiltSteer: settings.touch.tiltSteer,
                  tiltRangeDeg: settings.touch.tiltRangeDeg,
                  autoGearbox,
                  onPause: togglePause,
                  onCycleCamera: cycleCamera,
                  showHeadlights: Boolean(
                    weatherHud?.headlightsAutoOn ||
                      weatherHud?.headlightsOn ||
                      (weatherHud?.headlightMode && weatherHud.headlightMode !== "auto"),
                  ),
                  headlightsOn: Boolean(weatherHud?.headlightsOn),
                  onToggleHeadlights: () => session?.runAction("headlights"),
                }
              : null
          }
        />
      ) : null}

      {phase === "title" && !hudEditing ? (
        <TitleMenu
          {...menuProps}
          onCycleCamera={cycleCamera}
          firstRun={!onboarded}
          onDrive={() => handleTitleStart(false)}
          onRaceAi={() => handleTitleStart(true)}
          onControls={() => openSettings("title")}
          onOpenSettings={(category?: SettingsCategory) => openSettings("title", category)}
          trackId={trackId}
          onSelectTrack={onSelectTrack}
        />
      ) : null}

      {phase === "wizard" ? (
        <FirstRunWizard
          mode={wizardMode}
          settings={settings}
          onChangeSettings={handleChangeSettings}
          steerLockDeg={steerLockDeg}
          carId={carId}
          vehicleModel={vehicleModel}
          onChangeCar={handleChangeCar}
          selectedLivery={selectedLivery}
          onChangeLivery={handleLiveryChange}
          assistPreset={assistPreset}
          onChangeAssistPreset={handleAssistPresetChange}
          showRacingLine={showRacingLine}
          onSetRacingLine={setRacingLineVisible}
          gamepadAssist={gamepadAssist}
          onSetGamepadAssist={setGamepadAssistEnabled}
          autoGearbox={autoGearbox}
          onSetAutoGearbox={setAutoGearbox}
          gamepadRumble={gamepadRumble}
          onToggleGamepadRumble={handleToggleGamepadRumble}
          mouseSteerEnabled={mouseSteerEnabled}
          onSetMouseSteer={setMouseSteer}
          cameraMode={cameraMode}
          onChangeCameraMode={setCameraMode}
          onFinish={finishWizard}
          onExit={leaveWizard}
          onSkip={wizardMode === "first-run" ? finishWizard : undefined}
          onStepChange={handleWizardStep}
        />
      ) : null}

      {settingsOpen && !hudEditing ? (
        <SettingsScreen
          env={settingsEnv}
          initialCategory={settingsOpen.category}
          initialTab={settingsOpen.tab}
          onClose={closeSettings}
        />
      ) : null}

      {/* Wheel force feedback over WebHID waits for one pairing click: offered on the title and the pause menu (not over
          Settings, which offers it itself), never mid-lap */}
      <FfbPairPrompt wanted={hidFfbWanted && settings.wheel.steer !== null && !settingsOpen && (phase === "title" || (phase === "driving" && paused))} />
      <DualSensePairPrompt wanted={phase === "title" && !settingsOpen && !(hidFfbWanted && settings.wheel.steer !== null)} />

      {loadingVisible ? (
        // Under the GPU notice it takes no press: the notice's own buttons would start it too
        <LoadingScreen
          track={track}
          carId={carId}
          ready={assetsReady && !gpuNoticeKind}
          cameraKey={settings.keys.camera[0]}
          freeCameraKey={settings.keys.freeCamera[0]}
          tvCameraKey={settings.keys.tvCamera[0]}
          lineKey={settings.keys.racingLine[0]}
          onStart={handleLoadingStart}
          onDone={handleLoadingDone}
        />
      ) : null}

      <NowPlayingToast nowPlaying={nowPlaying} />

      {gpuNoticeKind ? (
        <GpuLostNotice
          kind={gpuNoticeKind}
          canLower={settings.graphics.quality !== "low"}
          onLower={() => restartAfterGpuLoss(true)}
          onRetry={() => restartAfterGpuLoss(false)}
          onReloadPage={() => window.location.reload()}
        />
      ) : null}
      <LapTelemetryModal
        open={analysisOpen && (sessionLaps.length > 0 || Boolean(allTimeBestLap) || Boolean(latestLap))}
        sessionLaps={sessionLaps}
        bestLap={allTimeBestLap}
        latestLap={latestLap}
        turns={trackTurns}
        sectorSplitsM={trackSectorSplitsM}
        trackName={getTrackInfo(trackId).name}
        onClose={() => setAnalysisOpen(false)}
      />
    </div>
  );
};

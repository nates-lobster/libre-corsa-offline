"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl/react";
import type { TurnMetadata, VehicleModelId } from "@/types/f1";
import { boardChoiceOf, boardChoiceOfLap, boardChoices, type LapRecording, type LeaderboardEntry } from "@/lib/sim/lap-types";
import type { SessionLapEntry } from "@/lib/sim/lap-analysis";
import { LapTelemetryView } from "./LapTelemetryView";
import { boardLabel } from "@/lib/net/leaderboard";
import { Button, Card, IconButton, EmptyState, Segmented, Select, SettingRow, Toast } from "@/components/ui";
import { Icon } from "@/components/ui/icons";
import { LapConditionBadges } from "@/components/board/LapConditionBadges";
import { BoardTable, type BoardRow } from "@/components/board/board-table";
import { formatDelta, formatLapTime } from "./hud-format";

export { BoardError, BoardSkeleton, BoardTable, MyPlace, type BoardRow } from "@/components/board/board-table";

const RaceGhost: React.FC<{ onClick: () => void; label: string; title: string }> = ({ onClick, label, title }) => (
  <IconButton size="sm" variant="secondary" icon={<Icon name="ghost" />} aria-label={label} title={title} onClick={onClick} />
);

export interface LeaderboardPanelProps {
  trackName: string;
  trackId?: string;
  trackNameOf?: (id: string) => string;
  vehicleLabel: (id: string) => string;
  local: LeaderboardEntry[];
  sessionLaps?: readonly SessionLapEntry[];
  allTimeBestLap?: LapRecording | null;
  latestLap?: LapRecording | null;
  turns?: readonly TurnMetadata[];
  sectorSplitsM?: readonly [number, number] | null;
  loadAllLocal?: () => Promise<LeaderboardEntry[]>;
  vehicle?: string;
  onRaceGhost?: (entry: LeaderboardEntry) => void;
  onApplySetup?: (entry: LeaderboardEntry) => Promise<void> | void;
  setupNotice?: { text: string; undo?: () => void } | null;
  onDismissSetupNotice?: () => void;
  onImportGhost?: (file: File) => void;
  onExportBest?: () => void;
}

const ALL_CARS = "all";

const boardOfLap = (e: LeaderboardEntry): string => {
  const choices = boardChoices(e.trackId);
  return (e.conditions ? boardChoiceOfLap(e.trackId, e.vehicle, e.conditions.physicsVersion) : null) ?? choices[choices.length - 1].id;
};

/**
 * Offline Lap Times & Telemetry Analysis: personal bests saved locally in this browser/app,
 * sector splits, theoretical best, ghost import/export, setup recall, and lap telemetry comparison.
 */
export const LeaderboardPanel: React.FC<LeaderboardPanelProps> = ({
  trackName,
  trackId,
  trackNameOf,
  vehicleLabel,
  local,
  sessionLaps,
  allTimeBestLap = null,
  latestLap = null,
  turns,
  sectorSplitsM = null,
  loadAllLocal,
  vehicle,
  onRaceGhost,
  onApplySetup,
  setupNotice = null,
  onDismissSetupNotice,
  onImportGhost,
  onExportBest,
}) => {
  const tx = useTranslations("hud.leaderboardPanel");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [subTab, setSubTab] = useState<"times" | "analysis">("times");

  const [allLocal, setAllLocal] = useState<LeaderboardEntry[] | null>(null);
  useEffect(() => {
    if (!loadAllLocal) return;
    let live = true;
    loadAllLocal()
      .then((laps) => {
        if (live) setAllLocal(laps);
      })
      .catch(() => {
        if (live) setAllLocal(null);
      });
    return () => {
      live = false;
    };
  }, [loadAllLocal, local]);

  const here = trackId ?? local[0]?.trackId ?? "";
  const [circuit, setCircuit] = useState(here);
  const [car, setCar] = useState<string>(ALL_CARS);
  const [boardPick, setBoardPick] = useState<string | null>(null);

  const choices = useMemo(() => boardChoices(circuit), [circuit]);
  const choice = boardChoiceOf(circuit, boardPick);
  const older = !choice.current;
  const allPool = allLocal ?? local;
  const nameOf = (id: string) => (id === here ? trackName : (trackNameOf?.(id) ?? id));

  const localCircuits = useMemo(() => {
    const ids = [...new Set(allPool.map((e) => e.trackId))];
    if (here && !ids.includes(here)) ids.push(here);
    return ids
      .map((id) => ({ id, label: id === here ? trackName : (trackNameOf?.(id) ?? id), count: allPool.filter((e) => e.trackId === id).length }))
      .sort((a, b) => (a.id === here ? -1 : b.id === here ? 1 : a.label.localeCompare(b.label)));
  }, [allPool, here, trackName, trackNameOf]);

  const localPicker = older || allPool.some((e) => e.trackId === circuit && boardOfLap(e) !== choices[0].id);
  const onCircuit = useMemo(() => allPool.filter((e) => e.trackId === circuit && boardOfLap(e) === choice.id), [allPool, circuit, choice.id]);

  const cars = useMemo(() => {
    const ids: string[] = [...new Set(onCircuit.map((e) => e.vehicle))];
    return [
      { id: ALL_CARS, label: tx("allCars"), count: onCircuit.length },
      ...ids.map((id) => ({ id, label: vehicleLabel(id), count: onCircuit.filter((e) => e.vehicle === id).length })),
    ];
  }, [onCircuit, vehicleLabel, tx]);
  const carShown = cars.some((c) => c.id === car) ? car : ALL_CARS;

  const rows = useMemo(
    () => onCircuit.filter((e) => carShown === ALL_CARS || e.vehicle === carShown).sort((a, b) => a.lapTimeMs - b.lapTimeMs),
    [onCircuit, carShown],
  );
  const bestSector = [0, 1, 2].map((i) => {
    const times = rows.map((r) => r.sectorTimesMs[i]).filter((t) => t > 0);
    return times.length ? Math.min(...times) : 0;
  });
  const theoretical = bestSector.every((t) => t > 0) ? bestSector[0] + bestSector[1] + bestSector[2] : 0;
  const bestLap = rows[0]?.lapTimeMs ?? 0;
  const toFind = theoretical && bestLap ? (theoretical - bestLap) / 1000 : 0;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file && onImportGhost) onImportGhost(file);
  };

  const localRows: BoardRow[] = rows.map((e, i) => {
    const board = e.conditions ? boardLabel(e.conditions) : null;
    const ghost =
      Boolean(onRaceGhost) && e.trackId === here ? (
        <RaceGhost label={tx("raceGhost", { car: vehicleLabel(e.vehicle) })} title={tx("raceGhostTitle")} onClick={() => onRaceGhost?.(e)} />
      ) : null;
    const setupBtn =
      onApplySetup && (e.hasSetup || e.setup) && (!vehicle || e.vehicle === vehicle) ? (
        <IconButton
          size="sm"
          variant="secondary"
          icon={<Icon name="garage" />}
          aria-label={tx("applySetup", { car: vehicleLabel(e.vehicle) })}
          title={tx("applySetupTitle")}
          onClick={() => void onApplySetup(e)}
        />
      ) : null;
    return {
      key: `${e.trackId}-${e.vehicle}-${e.recordedAt}-${i}`,
      rank: i + 1,
      title: vehicleLabel(e.vehicle),
      meta: e.conditions ? (
        <LapConditionBadges assists={e.conditions.assists} realism={e.conditions.realism} surface={e.conditions.surface} />
      ) : undefined,
      detail: new Date(e.recordedAt).toLocaleDateString(),
      detailTitle: `${board ? `${board} · ` : ""}${new Date(e.recordedAt).toLocaleString()}`,
      lapMs: e.lapTimeMs,
      fastest: i === 0 && rows.length > 1,
      sectorsMs: e.sectorTimesMs,
      bestSectors: e.sectorTimesMs.map((s, k) => s > 0 && s === bestSector[k] && rows.length > 1),
      action:
        setupBtn || ghost ? (
          <span className="inline-flex items-center gap-1.5">
            {setupBtn}
            {ghost}
          </span>
        ) : undefined,
    };
  });

  return (
    <div className="flex flex-col gap-3 text-lc-chalk">
      {sessionLaps ? (
        <div className="flex items-center justify-between gap-2">
          <Segmented
            aria-label={tx("viewLabel")}
            size="sm"
            value={subTab}
            onChange={(v) => setSubTab(v as "times" | "analysis")}
            options={[
              { id: "times", label: tx("tabTimes") },
              { id: "analysis", label: tx("tabAnalysis") },
            ]}
          />
        </div>
      ) : null}

      {subTab === "analysis" && (sessionLaps || allTimeBestLap || latestLap) ? (
        (sessionLaps && sessionLaps.length > 0) || allTimeBestLap || latestLap ? (
          <LapTelemetryView
            sessionLaps={sessionLaps ?? []}
            bestLap={allTimeBestLap}
            latestLap={latestLap}
            turns={turns}
            sectorSplitsM={sectorSplitsM}
          />
        ) : (
          <EmptyState icon={<Icon name="lapTimes" />}>{tx("analysisEmpty")}</EmptyState>
        )
      ) : (
        <>
          {onImportGhost || onExportBest ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {onImportGhost ? (
                <>
                  <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                    {tx("importGhost")}
                  </Button>
                  <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFile} />
                </>
              ) : null}
              {onExportBest ? (
                <Button size="sm" variant="secondary" icon={<Icon name="download" />} onClick={onExportBest}>
                  {tx("exportBest")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {setupNotice ? (
            <div role="status">
              <Toast
                tone="neutral"
                className="w-full"
                action={
                  <span className="flex items-center gap-1">
                    {setupNotice.undo ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setupNotice.undo?.();
                          onDismissSetupNotice?.();
                        }}
                      >
                        {tx("undo")}
                      </Button>
                    ) : null}
                    {onDismissSetupNotice ? (
                      <IconButton size="sm" variant="ghost" aria-label={tx("dismiss")} icon={<Icon name="close" />} onClick={onDismissSetupNotice} />
                    ) : null}
                  </span>
                }
              >
                {setupNotice.text}
              </Toast>
            </div>
          ) : null}

          {localCircuits.length > 1 ? (
            <SettingRow label={tx("circuit")}>
              <Select
                className="w-64 max-w-full"
                value={circuit}
                onChange={setCircuit}
                options={localCircuits.map((c) => ({ id: c.id, label: c.label, detail: tx("circuitLaps", { count: c.count }) }))}
              />
            </SettingRow>
          ) : null}

          <Card
            title={tx("yourBestLaps")}
            description={older ? `${nameOf(circuit)} · ${choice.label}` : nameOf(circuit)}
            action={
              cars.length > 2 || localPicker ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {localPicker ? (
                    choices.length <= 2 ? (
                      <Segmented aria-label={tx("physicsVersion")} size="sm" value={choice.id} onChange={setBoardPick} options={choices} />
                    ) : (
                      <Select aria-label={tx("physicsVersion")} className="w-56 max-w-full" value={choice.id} onChange={setBoardPick} options={choices} />
                    )
                  ) : null}
                  {cars.length > 2 ? (
                    <Select
                      aria-label={tx("car")}
                      className="w-56 max-w-full"
                      value={carShown}
                      onChange={setCar}
                      options={cars.map((c) => ({ id: c.id, label: c.label, detail: tx("carLaps", { count: c.count }) }))}
                    />
                  ) : null}
                </div>
              ) : undefined
            }
          >
            {rows.length === 0 ? (
              <EmptyState icon={<Icon name="lapTimes" />}>
                {older ? tx("noLapsOlder", { circuit: nameOf(circuit), board: choice.label }) : tx("noLaps", { circuit: nameOf(circuit) })}
              </EmptyState>
            ) : (
              <BoardTable
                label={tx("tableLabel", { circuit: nameOf(circuit) })}
                nameHeader={tx("carColumn")}
                rows={localRows}
                footer={
                  theoretical && rows.length > 1 ? (
                    <div className="mt-1 flex items-center justify-between gap-4 rounded-lc-row bg-white/3 px-2 py-2.5">
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[14px] font-semibold text-lc-chalk">{tx("theoreticalBest")}</span>
                        <span className="lc-hint">{toFind < 0 ? tx("potential", { delta: formatDelta(toFind) }) : tx("allBestSectors")}</span>
                      </span>
                      <span className="lc-mono text-[15px] font-bold text-lc-fog">{formatLapTime(theoretical)}</span>
                    </div>
                  ) : null
                }
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
};

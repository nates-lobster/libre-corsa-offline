"use client";

/**
 * Offline Home Hub Lap Times: displays locally recorded personal best laps stored in IndexedDB,
 * filterable by circuit, with sector splits and lap condition badges. Zero network requests.
 */
import React, { useEffect, useMemo, useState } from "react";
import { t, useI18nState } from "@/i18n/runtime";
import type { VehicleModelId } from "@/types/f1";
import type { LeaderboardEntry } from "@/lib/sim/lap-types";
import { allLocalLeaderboards } from "@/lib/net/leaderboard";
import { Card, EmptyState, Select, SettingRow } from "@/components/ui";
import { Icon } from "@/components/ui/icons";
import { BoardTable, type BoardRow } from "@/components/board/board-table";
import { LapConditionBadges } from "@/components/board/LapConditionBadges";

export interface BoardCarTag {
  label: string;
  color: string;
}

export interface HomeLapTimesProps {
  circuits: readonly { id: string; label: string }[];
  circuit: string;
  carTags: Readonly<Partial<Record<VehicleModelId, BoardCarTag>>>;
  carChoices: readonly { id: VehicleModelId; label: string; detail?: string }[];
  carTitles: Readonly<Record<string, string>>;
  scrollRoot: React.RefObject<HTMLElement | null>;
  onShown?: (shown: boolean) => void;
}

export const HomeLapTimes: React.FC<HomeLapTimesProps> = ({
  circuits,
  circuit,
  carTitles,
  onShown,
}) => {
  useI18nState();
  const [laps, setLaps] = useState<LeaderboardEntry[] | null>(null);
  const [picked, setPicked] = useState<{ from: string; id: string } | null>(null);
  const shownCircuit = picked && picked.from === circuit ? picked.id : circuit;

  useEffect(() => {
    let live = true;
    allLocalLeaderboards()
      .then((entries) => {
        if (live) setLaps(entries);
      })
      .catch(() => {
        if (live) setLaps([]);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    onShown?.(false);
  }, [onShown]);

  const filtered = useMemo(
    () => (laps ?? []).filter((e) => e.trackId === shownCircuit).sort((a, b) => a.lapTimeMs - b.lapTimeMs),
    [laps, shownCircuit],
  );

  const bestSector = useMemo(
    () =>
      [0, 1, 2].map((i) => {
        const times = filtered.map((r) => r.sectorTimesMs[i]).filter((ms) => ms > 0);
        return times.length ? Math.min(...times) : 0;
      }),
    [filtered],
  );

  const rows: BoardRow[] = useMemo(
    () =>
      filtered.map((e, i) => ({
        key: `${e.trackId}-${e.vehicle}-${e.recordedAt}-${i}`,
        rank: i + 1,
        title: carTitles[e.vehicle] ?? e.vehicle,
        meta: e.conditions ? (
          <LapConditionBadges assists={e.conditions.assists} realism={e.conditions.realism} surface={e.conditions.surface} />
        ) : undefined,
        detail: new Date(e.recordedAt).toLocaleDateString(),
        lapMs: e.lapTimeMs,
        fastest: i === 0 && filtered.length > 1,
        sectorsMs: e.sectorTimesMs,
        bestSectors: e.sectorTimesMs.map((s, k) => s > 0 && s === bestSector[k] && filtered.length > 1),
      })),
    [filtered, carTitles, bestSector],
  );

  const circuitLabel = circuits.find((c) => c.id === shownCircuit)?.label ?? shownCircuit;

  return (
    <div className="mx-auto flex min-h-px w-full max-w-[1200px] flex-col gap-4">
      {circuits.length > 1 ? (
        <SettingRow label={t("hud.leaderboardPanel.circuit")}>
          <Select
            className="w-72 max-w-full"
            value={shownCircuit}
            onChange={(id) => setPicked({ from: circuit, id })}
            options={circuits.map((c) => ({ id: c.id, label: c.label }))}
          />
        </SettingRow>
      ) : null}

      <Card title={t("hud.leaderboardPanel.yourBestLaps")} description={`${circuitLabel} · Saved locally on this device`}>
        {rows.length === 0 ? (
          <EmptyState icon={<Icon name="lapTimes" size="lg" />}>
            {laps === null ? "Loading local lap times…" : `No local laps saved for ${circuitLabel} yet. Hit Drive to set your first benchmark.`}
          </EmptyState>
        ) : (
          <BoardTable
            label={`Local best laps at ${circuitLabel}`}
            nameHeader={t("hud.leaderboardPanel.carColumn")}
            rows={rows}
          />
        )}
      </Card>
    </div>
  );
};

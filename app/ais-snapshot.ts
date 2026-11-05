import { AISSTREAM_MAX_VESSELS, AISSTREAM_WINDOW_MS } from "./aisstream-config";
import { toAisVessel, type Vessel } from "./ais-vessel";

export type SnapshotReason = "window_elapsed" | "limit_reached";

export type SnapshotResult = {
  vessels: Vessel[];
  collectedAt: string;
  windowSeconds: number;
  count: number;
  truncated: boolean;
  reason: SnapshotReason;
};

export type PositionReportStreamOptions = {
  apiKey: string;
  signal?: AbortSignal;
  windowMs: number;
  now: () => string;
  onPositionReport: (message: unknown) => boolean;
};

export type PositionReportStream = (
  options: PositionReportStreamOptions,
) => Promise<{ reason: SnapshotReason; collectedAt: string }>;

export type SnapshotCollectorOptions = {
  apiKey: string;
  signal?: AbortSignal;
  readStream: PositionReportStream;
  now?: () => string;
  windowMs?: number;
  limit?: number;
};

export async function collectAisSnapshot({
  apiKey,
  signal,
  readStream,
  now = () => new Date().toISOString(),
  windowMs = AISSTREAM_WINDOW_MS,
  limit = AISSTREAM_MAX_VESSELS,
}: SnapshotCollectorOptions): Promise<SnapshotResult> {
  const vesselsById = new Map<string, Vessel>();
  const streamResult = await readStream({
    apiKey,
    signal,
    windowMs,
    now,
    onPositionReport(message) {
      const vessel = toAisVessel(message);
      if (!vessel) return false;

      const existing = vesselsById.get(vessel.id);
      if (!existing || vessel.timestamp > existing.timestamp) {
        vesselsById.set(vessel.id, vessel);
      }

      return vesselsById.size >= limit;
    },
  });
  const vessels = [...vesselsById.values()];

  return {
    vessels,
    collectedAt: streamResult.collectedAt,
    windowSeconds: windowMs / 1000,
    count: vessels.length,
    truncated: streamResult.reason === "limit_reached",
    reason: streamResult.reason,
  };
}

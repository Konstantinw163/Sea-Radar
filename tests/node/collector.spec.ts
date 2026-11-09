import { expect, test } from "@playwright/test";
import positionReportSample from "../../data/samples/position-report.sample.json";
import { collectAisSnapshot, type PositionReportStream } from "../../app/ais-snapshot";

function report(id: number, timestamp: string, lat: number, lon: number, name = "A") {
  const message = structuredClone(positionReportSample);
  message.MetaData.MMSI = id;
  message.MetaData.time_utc = timestamp;
  message.MetaData.ShipName = name;
  message.Message.PositionReport.Latitude = lat;
  message.Message.PositionReport.Longitude = lon;
  return message;
}

test("deduplicates, keeps the newest message, and keeps first on equal time", async () => {
  const messages = [
    report(1, "2026-01-01 12:01:00.000000000 +0000 UTC", 51.1, 1.4),
    report(1, "2026-01-01 12:01:00.000000000 +0000 UTC", 51.2, 1.5),
    report(1, "2026-01-01 12:00:00.000000000 +0000 UTC", 50.9, 1.2),
  ];
  const result = await collectAisSnapshot({
    apiKey: "test",
    readStream: async ({ onPositionReport }) => {
      for (const message of messages) onPositionReport(message);
      return { reason: "window_elapsed", collectedAt: "2026-01-01T12:02:00.000Z" };
    },
  });
  expect(result.vessels).toHaveLength(1);
  expect(result.vessels[0]).toMatchObject({ id: "1", lat: 51.1, lon: 1.4 });
});

test("accepts exactly 100 unique valid vessels and stops before the 101st", async () => {
  let accepted101 = false;
  const stream: PositionReportStream = async ({ onPositionReport }) => {
    for (let id = 1; id <= 101; id += 1) {
      const limitReached = onPositionReport(report(id, "2026-01-01 12:00:00.000000000 +0000 UTC", 51, 1));
      if (id === 101) accepted101 = true;
      if (limitReached) return { reason: "limit_reached", collectedAt: "2026-01-01T12:00:01.000Z" };
    }
    return { reason: "window_elapsed", collectedAt: "2026-01-01T12:00:15.000Z" };
  };
  const result = await collectAisSnapshot({ apiKey: "test", readStream: stream, limit: 100 });
  expect(result).toMatchObject({ count: 100, truncated: true, reason: "limit_reached" });
  expect(result.vessels.at(-1)?.id).toBe("100");
  expect(accepted101).toBe(false);
});

test("repeated same-vessel reports do not hit the unique-vessel limit", async () => {
  let finishWindow!: () => void;
  let reachedLimit = false;
  const run = collectAisSnapshot({
    apiKey: "test",
    limit: 100,
    readStream: ({ onPositionReport }) => new Promise((resolve) => {
      for (let i = 0; i < 100; i += 1) {
        reachedLimit ||= onPositionReport(report(1, "2026-01-01 12:00:00.000000000 +0000 UTC", 51, 1));
      }
      finishWindow = () => resolve({ reason: "window_elapsed", collectedAt: "2026-01-01T12:00:15.000Z" });
    }),
  });
  expect(reachedLimit).toBe(false);
  finishWindow();
  const result = await run;
  expect(result).toMatchObject({ count: 1, reason: "window_elapsed" });
});

test("an empty live window is a successful empty snapshot", async () => {
  const result = await collectAisSnapshot({
    apiKey: "test",
    readStream: async () => ({ reason: "window_elapsed", collectedAt: "2026-01-01T12:00:15.000Z" }),
  });
  expect(result).toMatchObject({ vessels: [], count: 0, reason: "window_elapsed", truncated: false });
});

test("a newer null name replaces the entire vessel object", async () => {
  const first = report(1, "2026-01-01 12:00:00.000000000 +0000 UTC", 51, 1, "A");
  const second = report(1, "2026-01-01 12:01:00.000000000 +0000 UTC", 51.1, 1.1, "   ");
  const result = await collectAisSnapshot({
    apiKey: "test",
    now: () => "2026-01-01T12:02:00.000Z",
    readStream: async ({ onPositionReport, now }) => {
      onPositionReport(first);
      onPositionReport(second);
      return { reason: "window_elapsed", collectedAt: now() };
    },
  });
  expect(result.vessels[0]).toMatchObject({ name: null, lat: 51.1, lon: 1.1 });
  expect(result.collectedAt).toBe("2026-01-01T12:02:00.000Z");
});

 test("stream failures reject instead of returning a partial snapshot", async () => {
  for (const code of ["connect_failed", "provider_error", "disconnected"] as const) {
    const readStream: PositionReportStream = async ({ onPositionReport }) => {
      if (code !== "connect_failed") {
        for (let id = 1; id <= 3; id += 1) {
          onPositionReport(report(id, "2026-01-01 12:00:00.000000000 +0000 UTC", 51, 1));
        }
      }
      throw Object.assign(new Error(code), { code });
    };
    await expect(collectAisSnapshot({ apiKey: "test", readStream })).rejects.toMatchObject({ code });
  }
});

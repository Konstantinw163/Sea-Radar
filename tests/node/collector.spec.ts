import { expect, test } from "@playwright/test";
import positionReportSample from "../../data/samples/position-report.sample.json";
import { collectAisSnapshot, type PositionReportStream } from "../../app/ais-snapshot";
import { readAisPositionReports, type SocketLike } from "../../app/aisstream-protocol";

type Listener = (event: { data?: unknown }) => void;

class TestSocket implements SocketLike {
  listeners = new Map<string, Set<Listener>>();
  closeCalls = 0;
  readyState = 0;

  addEventListener(type: string, listener: Listener) {
    const group = this.listeners.get(type) ?? new Set<Listener>();
    group.add(listener);
    this.listeners.set(type, group);
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }
  send() {}
  close() { this.closeCalls += 1; this.readyState = 3; }
  emit(type: string, event: { data?: unknown } = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

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

test("100 reports for one vessel continue until the managed window timer fires", async () => {
  const socket = new TestSocket();
  let fireWindow!: () => void;
  let timerDelay = 0;
  let clearedTimers = 0;
  let clockTime = "2026-01-01T12:00:00.000Z";
  const run = collectAisSnapshot({
    apiKey: "test",
    now: () => clockTime,
    readStream: (options) => readAisPositionReports({
      ...options,
      createSocket: () => socket,
      setTimer(callback, delay) {
        timerDelay = delay;
        fireWindow = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer() { clearedTimers += 1; },
    }),
  });

  socket.readyState = 1;
  socket.emit("open");
  for (let i = 0; i < 100; i += 1) {
    socket.emit("message", {
      data: JSON.stringify(report(1, "2026-01-01 12:00:00.000000000 +0000 UTC", 51, 1)),
    });
  }
  expect(timerDelay).toBe(15_000);
  expect(clearedTimers).toBe(0);

  clockTime = "2026-01-01T12:00:15.000Z";
  fireWindow();
  const result = await run;
  expect(result).toMatchObject({
    count: 1,
    reason: "window_elapsed",
    truncated: false,
    collectedAt: "2026-01-01T12:00:15.000Z",
  });
  expect(socket.closeCalls).toBe(1);
  expect(clearedTimers).toBe(1);
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

test("provider errors and disconnects after three positions reject the partial snapshot", async () => {
  for (const event of ["error", "close"] as const) {
    const socket = new TestSocket();
    let timerCallback: (() => void) | undefined;
    let clearedTimers = 0;
    const readStream: PositionReportStream = (options) => readAisPositionReports({
      ...options,
      createSocket: () => socket,
      setTimer(callback) {
        timerCallback = callback;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer() { clearedTimers += 1; },
    });
    const run = collectAisSnapshot({ apiKey: "test", readStream });
    socket.readyState = 1;
    socket.emit("open");
    for (let id = 1; id <= 3; id += 1) {
      socket.emit("message", {
        data: JSON.stringify(report(id, `2026-01-01 12:00:0${id}.000000000 +0000 UTC`, 51, 1)),
      });
    }
    socket.emit(event);

    await expect(run).rejects.toMatchObject({
      code: event === "error" ? "provider_error" : "disconnected",
    });
    expect(socket.closeCalls).toBe(1);
    expect(clearedTimers).toBe(1);
    expect([...socket.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    expect(timerCallback).toBeDefined();
  }
});

test("connection failure before collection rejects", async () => {
  const readStream: PositionReportStream = async () => {
    throw Object.assign(new Error("connect_failed"), { code: "connect_failed" });
  };
  await expect(collectAisSnapshot({ apiKey: "test", readStream })).rejects.toMatchObject({ code: "connect_failed" });
});

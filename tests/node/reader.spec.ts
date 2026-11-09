import { expect, test } from "@playwright/test";
import { readAisPositionReports, type SocketLike } from "../../app/aisstream-protocol";

type Listener = (event: { data?: unknown }) => void;

class TestSocket implements SocketLike {
  listeners = new Map<string, Set<Listener>>();
  sent: string[] = [];
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
  send(data: string) { this.sent.push(data); }
  close() { this.closeCalls += 1; this.readyState = 3; }
  emit(type: string, event: { data?: unknown } = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

function controllableTimer() {
  let callback: (() => void) | undefined;
  let cleared = 0;
  return {
    setTimer(fn: () => void) { callback = fn; return 1 as ReturnType<typeof setTimeout>; },
    clearTimer() { cleared += 1; },
    fire() { callback?.(); },
    cleared: () => cleared,
  };
}

test("connect timeout rejects and closes socket while clearing timer and listeners", async () => {
  const socket = new TestSocket();
  const timer = controllableTimer();
  const promise = readAisPositionReports({
    apiKey: "test",
    onPositionReport: () => false,
    createSocket: () => socket,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    now: () => "2026-01-01T12:00:15.000Z",
    windowMs: 15_000,
  });
  timer.fire();
  await expect(promise).rejects.toMatchObject({ code: "connect_failed" });
  expect(socket.closeCalls).toBe(1);
  expect(timer.cleared()).toBe(1);
  expect([...socket.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
});

test("socket error before open fails immediately and cleans resources", async () => {
  const socket = new TestSocket();
  const timer = controllableTimer();
  const promise = readAisPositionReports({
    apiKey: "test", onPositionReport: () => false, createSocket: () => socket,
    setTimer: timer.setTimer, clearTimer: timer.clearTimer,
  });
  socket.emit("error");
  await expect(promise).rejects.toMatchObject({ code: "connect_failed" });
  expect(socket.closeCalls).toBe(1);
  expect(timer.cleared()).toBe(1);
});

test("abort leaves no result and closes socket while clearing resources", async () => {
  const socket = new TestSocket();
  const timer = controllableTimer();
  const controller = new AbortController();
  const promise = readAisPositionReports({
    apiKey: "test", onPositionReport: () => false, createSocket: () => socket,
    setTimer: timer.setTimer, clearTimer: timer.clearTimer, signal: controller.signal,
  });
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  expect(socket.closeCalls).toBe(1);
  expect(timer.cleared()).toBe(1);
  expect([...socket.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
});

test("provider error and disconnect after subscription fail and clean resources", async () => {
  for (const event of ["error", "close"] as const) {
    const socket = new TestSocket();
    const timer = controllableTimer();
    const promise = readAisPositionReports({
      apiKey: "test", onPositionReport: () => false, createSocket: () => socket,
      setTimer: timer.setTimer, clearTimer: timer.clearTimer,
    });
    socket.readyState = 1;
    socket.emit("open");
    socket.emit(event);
    await expect(promise).rejects.toMatchObject({
      code: event === "error" ? "provider_error" : "disconnected",
    });
    expect(socket.closeCalls).toBe(1);
    expect(timer.cleared()).toBe(1);
    expect([...socket.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  }
});

test("a live connection succeeds at the window deadline and cleans resources", async () => {
  const socket = new TestSocket();
  const timer = controllableTimer();
  const promise = readAisPositionReports({
    apiKey: "test", onPositionReport: () => false, createSocket: () => socket,
    setTimer: timer.setTimer, clearTimer: timer.clearTimer,
    now: () => "2026-01-01T12:00:15.000Z",
  });
  socket.readyState = 1;
  socket.emit("open");
  timer.fire();
  await expect(promise).resolves.toEqual({ reason: "window_elapsed", collectedAt: "2026-01-01T12:00:15.000Z" });
  expect(socket.closeCalls).toBe(1);
  expect(timer.cleared()).toBe(1);
  expect([...socket.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
});

test("limit completion is settled once and ignores later provider errors", async () => {
  const socket = new TestSocket();
  const timer = controllableTimer();
  let nowCalls = 0;
  const promise = readAisPositionReports({
    apiKey: "test", onPositionReport: () => true, createSocket: () => socket,
    setTimer: timer.setTimer, clearTimer: timer.clearTimer,
    now: () => { nowCalls += 1; return "2026-01-01T12:00:01.000Z"; },
  });
  socket.readyState = 1;
  socket.emit("open");
  expect(JSON.parse(socket.sent[0])).toMatchObject({ APIKey: "test", FilterMessageTypes: ["PositionReport"] });
  socket.emit("message", { data: JSON.stringify({ MessageType: "PositionReport" }) });
  await expect(promise).resolves.toEqual({ reason: "limit_reached", collectedAt: "2026-01-01T12:00:01.000Z" });
  socket.emit("error");
  timer.fire();
  expect(nowCalls).toBe(1);
  expect(timer.cleared()).toBe(1);
  expect(socket.closeCalls).toBe(1);
});

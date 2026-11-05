import { AISSTREAM_WINDOW_MS } from "./aisstream-config";

export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";

const BOUNDING_BOXES = [[[50.75, 0.95], [51.25, 1.95]]];

type ReaderErrorCode = "connect_failed" | "provider_error" | "disconnected" | "internal";

type SocketEvent = { data?: unknown };

export interface SocketLike {
  addEventListener(type: string, listener: (event: SocketEvent) => void): void;
  removeEventListener(type: string, listener: (event: SocketEvent) => void): void;
  send(data: string): void;
  close(): void;
  binaryType?: BinaryType;
  readonly readyState: number;
}

export type ReaderOptions = {
  apiKey: string;
  onPositionReport: (message: unknown) => boolean;
  createSocket: (url: string) => SocketLike;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  now?: () => string;
  windowMs?: number;
  signal?: AbortSignal;
};

export type ReaderResult = {
  reason: "window_elapsed" | "limit_reached";
  collectedAt: string;
};

export type ReaderError = Error & { code: ReaderErrorCode };

function readerError(code: ReaderErrorCode): ReaderError {
  const error = new Error(code) as ReaderError;
  error.code = code;
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readAisPositionReports({
  apiKey,
  onPositionReport,
  createSocket,
  setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer = (timer) => clearTimeout(timer),
  now = () => new Date().toISOString(),
  windowMs = AISSTREAM_WINDOW_MS,
  signal,
}: ReaderOptions): Promise<ReaderResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Request aborted", "AbortError"));
      return;
    }

    let socket: SocketLike;
    try {
      socket = createSocket(AISSTREAM_URL);
    } catch {
      reject(readerError("connect_failed"));
      return;
    }

    let opened = false;
    let subscribed = false;
    let settled = false;
    const timerRef: { current?: ReturnType<typeof setTimeout> } = {};

    const cleanup = () => {
      if (timerRef.current !== undefined) clearTimer(timerRef.current);
      signal?.removeEventListener("abort", onAbort);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      if (socket.readyState < 2) {
        try {
          socket.close();
        } catch {
          // Cleanup must not replace the original result.
        }
      }
    };

    const finish = (reason: ReaderResult["reason"]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ reason, collectedAt: now() });
    };

    const fail = (code: ReaderErrorCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(readerError(code));
    };

    const onOpen = () => {
      if (settled) return;
      opened = true;
      try {
        socket.send(
          JSON.stringify({
            APIKey: apiKey,
            BoundingBoxes: BOUNDING_BOXES,
            FilterMessageTypes: ["PositionReport"],
          }),
        );
        subscribed = true;
      } catch {
        fail("connect_failed");
      }
    };

    const onMessage = (event: SocketEvent) => {
      if (settled) return;
      const data = event.data;
      let message: unknown;
      try {
        const text =
          typeof data === "string"
            ? data
            : data instanceof ArrayBuffer
              ? new TextDecoder().decode(data)
              : null;
        if (text === null) {
          fail("provider_error");
          return;
        }
        message = JSON.parse(text) as unknown;
      } catch {
        fail("provider_error");
        return;
      }

      if (!isRecord(message)) {
        fail("provider_error");
        return;
      }
      if (message.MessageType === "SubscriptionConfirmation") return;
      if (message.MessageType !== "PositionReport") {
        fail("provider_error");
        return;
      }

      try {
        if (onPositionReport(message)) finish("limit_reached");
      } catch {
        fail("internal");
      }
    };

    const onError = () => {
      fail(opened ? "provider_error" : "connect_failed");
    };

    const onClose = () => {
      if (!settled) fail(subscribed ? "disconnected" : "connect_failed");
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException("Request aborted", "AbortError"));
    };

    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", onOpen);
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });

    timerRef.current = setTimer(() => {
      if (settled) return;
      if (!opened || !subscribed) {
        fail("connect_failed");
      } else {
        finish("window_elapsed");
      }
    }, windowMs);

    if (signal?.aborted) onAbort();
  });
}

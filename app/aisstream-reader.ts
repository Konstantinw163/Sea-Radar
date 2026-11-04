import "server-only";

export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
export const AISSTREAM_WINDOW_MS = 15_000;

const BOUNDING_BOXES = [[[50.75, 0.95], [51.25, 1.95]]];

type ReaderErrorCode = "connect_failed" | "provider_error" | "disconnected" | "internal";

export type ReaderError = Error & { code: ReaderErrorCode };

type SocketEvent = { data?: unknown; message?: string };

export interface SocketLike {
  addEventListener(type: string, listener: (event: SocketEvent) => void): void;
  removeEventListener(type: string, listener: (event: SocketEvent) => void): void;
  send(data: string): void;
  close(): void;
  binaryType?: BinaryType;
  readonly readyState: number;
}

export interface ReaderOptions {
  apiKey: string;
  createSocket?: (url: string) => SocketLike;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  now?: () => string;
  windowMs?: number;
  signal?: AbortSignal;
}

export type ReaderResult = {
  raw: unknown | null;
  collectedAt: string;
};

function readerError(code: ReaderErrorCode): ReaderError {
  const error = new Error(code) as ReaderError;
  error.code = code;
  return error;
}

function createDefaultSocket(url: string): SocketLike {
  return new WebSocket(url);
}

export function readFirstAisStreamMessage({
  apiKey,
  createSocket = createDefaultSocket,
  setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer = (timer) => clearTimeout(timer),
  now = () => new Date().toISOString(),
  windowMs = AISSTREAM_WINDOW_MS,
  signal,
}: ReaderOptions): Promise<ReaderResult> {
  return new Promise((resolve, reject) => {
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

    const cleanup = (closeSocket: boolean) => {
      if (timerRef.current !== undefined) clearTimer(timerRef.current);
      signal?.removeEventListener("abort", onAbort);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      if (closeSocket && socket.readyState < 2) {
        try {
          socket.close();
        } catch {
          // Cleanup must not replace the original result.
        }
      }
    };

    const succeed = (raw: unknown | null) => {
      if (settled) return;
      settled = true;
      cleanup(true);
      resolve({ raw, collectedAt: now() });
    };

    const fail = (code: ReaderErrorCode) => {
      if (settled) return;
      settled = true;
      cleanup(true);
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

      if (typeof message !== "object" || message === null || Array.isArray(message)) {
        fail("provider_error");
        return;
      }

      const messageType = (message as { MessageType?: unknown }).MessageType;
      if (messageType === "SubscriptionConfirmation") return;
      if (messageType !== "PositionReport") {
        fail("provider_error");
        return;
      }

      succeed(message);
    };

    const onError = () => {
      fail(opened ? "provider_error" : "connect_failed");
    };

    const onClose = () => {
      if (!settled) {
        fail(subscribed ? "disconnected" : "connect_failed");
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup(true);
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
        succeed(null);
      }
    }, windowMs);

    if (signal?.aborted) onAbort();
  });
}

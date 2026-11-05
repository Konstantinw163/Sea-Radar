import "server-only";

import { collectAisSnapshot, type PositionReportStream } from "../../ais-snapshot";
import { readAisPositionReports, type ReaderError } from "../../aisstream-reader";

const ERROR_MESSAGES = {
  no_api_key: "Ключ AISStream не настроен",
  connect_failed: "Не удалось подключиться к источнику",
  provider_error: "Источник вернул ошибку",
  disconnected: "Соединение с источником разорвано",
  internal: "Внутренняя ошибка сервера",
} as const;

type ErrorCode = keyof typeof ERROR_MESSAGES;

type SnapshotHandlerOptions = {
  getApiKey?: () => string | undefined;
  readStream?: PositionReportStream;
  now?: () => string;
};

function jsonError(code: ErrorCode, attemptedAt: string): Response {
  return Response.json(
    {
      ok: false,
      attemptedAt,
      error: { code, message: ERROR_MESSAGES[code] },
    },
    { status: 502, headers: { "Cache-Control": "no-store" } },
  );
}

export function createSnapshotHandler({
  getApiKey = () => process.env.AISSTREAM_API_KEY,
  readStream = readAisPositionReports,
  now = () => new Date().toISOString(),
}: SnapshotHandlerOptions = {}) {
  return async function GET(request: Request): Promise<Response> {
    const attemptedAt = now();
    const apiKey = getApiKey()?.trim();

    if (!apiKey) {
      return jsonError("no_api_key", attemptedAt);
    }

    try {
      const snapshot = await collectAisSnapshot({
        apiKey,
        signal: request.signal,
        readStream,
        now,
      });

      return Response.json(
        { ok: true, ...snapshot },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (request.signal.aborted) {
        return jsonError("internal", attemptedAt);
      }

      const code = (error as Partial<ReaderError> | null)?.code;
      if (
        code === "connect_failed" ||
        code === "provider_error" ||
        code === "disconnected" ||
        code === "internal"
      ) {
        return jsonError(code, attemptedAt);
      }

      return jsonError("internal", attemptedAt);
    }
  };
}

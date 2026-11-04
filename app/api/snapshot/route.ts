import { readFirstAisStreamMessage, type ReaderError } from "../../aisstream-reader";

export const runtime = "nodejs";

const ERROR_MESSAGES = {
  no_api_key: "Ключ AISStream не настроен",
  connect_failed: "Не удалось подключиться к источнику",
  provider_error: "Источник вернул ошибку",
  disconnected: "Соединение с источником разорвано",
  internal: "Внутренняя ошибка сервера",
} as const;

type ErrorCode = keyof typeof ERROR_MESSAGES;

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

export async function GET(request: Request): Promise<Response> {
  const attemptedAt = new Date().toISOString();
  const apiKey = process.env.AISSTREAM_API_KEY?.trim();

  if (!apiKey) {
    return jsonError("no_api_key", attemptedAt);
  }

  try {
    const result = await readFirstAisStreamMessage({
      apiKey,
      signal: request.signal,
    });

    return Response.json(
      { ok: true, ...result },
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
}

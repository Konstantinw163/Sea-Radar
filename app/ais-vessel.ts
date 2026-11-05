export type VesselFields = {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  speedKnots: number | null;
  courseDeg: number | null;
  timestamp: string;
};

export type Vessel = VesselFields & { source: "aisstream" };

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUtcTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))? ([+-])(\d{2})(\d{2}) UTC$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));

  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }

  const milliseconds = fraction.slice(0, 3).padEnd(3, "0");
  const offset = `${sign}${offsetHourText}:${offsetMinuteText}`;
  const parsed = new Date(`${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}.${milliseconds}${offset}`);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function optionalSpeed(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 102.2
    ? value
    : null;
}

function optionalCourse(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 360
    ? value
    : null;
}

export function toAisVessel(message: unknown): Vessel | null {
  if (!isRecord(message) || message.MessageType !== "PositionReport") return null;

  const metaData = message.MetaData;
  const body = message.Message;
  if (!isRecord(metaData) || !isRecord(body) || !isRecord(body.PositionReport)) return null;

  const mmsi = metaData.MMSI;
  const id =
    typeof mmsi === "string"
      ? mmsi.trim()
      : typeof mmsi === "number" && Number.isFinite(mmsi)
        ? String(mmsi)
        : "";
  const positionReport = body.PositionReport;
  const lat = positionReport.Latitude;
  const lon = positionReport.Longitude;
  const timestamp = parseUtcTimestamp(metaData.time_utc);

  if (
    id.length === 0 ||
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    typeof lon !== "number" ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180 ||
    timestamp === null
  ) {
    return null;
  }

  const name = typeof metaData.ShipName === "string" ? metaData.ShipName.trim() || null : null;

  return {
    id,
    name,
    lat,
    lon,
    speedKnots: optionalSpeed(positionReport.Sog),
    courseDeg: optionalCourse(positionReport.Cog),
    timestamp,
    source: "aisstream",
  };
}

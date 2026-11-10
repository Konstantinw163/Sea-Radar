"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import type { Vessel, VesselFields } from "../ais-vessel";

type DemoVessel = VesselFields & {
  source: "demo";
  route: readonly (readonly [number, number])[];
  routeIndex: number;
  stopped: boolean;
};

type DisplayVessel = Vessel | DemoVessel;

type DisplayState = "demo" | "ais";

type SnapshotSuccess = {
  ok: true;
  vessels: Vessel[];
  collectedAt: string;
  windowSeconds: number;
  count: number;
  truncated: boolean;
  reason: "window_elapsed" | "limit_reached";
};

const DEMO_TICK_MS = 2000;

const MAP_CONFIG = {
  bounds: [
    [50.75, 0.95],
    [51.25, 1.95],
  ] as [[number, number], [number, number]],
  center: [51.0, 1.45] as [number, number],
  zoom: 10,
};

const VESSEL_CONFIG = [
  {
    id: "demo-1",
    name: "Демо-судно 1",
    speedKnots: 12,
    route: [
      [51.0, 1.45],
      [51.01, 1.48],
      [51.02, 1.51],
      [51.03, 1.54],
      [51.04, 1.57],
      [51.05, 1.6],
      [51.06, 1.63],
      [51.07, 1.66],
      [51.08, 1.69],
      [51.09, 1.72],
    ],
  },
  {
    id: "demo-2",
    name: "Демо-судно 2",
    speedKnots: 8.5,
    route: [
      [50.8, 1.1],
      [50.815, 1.135],
      [50.83, 1.17],
      [50.845, 1.205],
      [50.86, 1.24],
      [50.875, 1.275],
      [50.89, 1.31],
      [50.905, 1.345],
      [50.92, 1.38],
      [50.935, 1.415],
    ],
  },
  {
    id: "demo-3",
    name: "Демо-судно 3",
    speedKnots: 10,
    route: [
      [51.2, 1.1],
      [51.18, 1.135],
      [51.16, 1.17],
      [51.14, 1.205],
      [51.12, 1.24],
      [51.1, 1.275],
      [51.08, 1.31],
      [51.06, 1.345],
      [51.04, 1.38],
      [51.02, 1.415],
    ],
  },
] as const;

type VesselConfig = (typeof VESSEL_CONFIG)[number];
type LatLon = readonly [number, number];

const API_ERROR_MESSAGES: Record<string, string> = {
  no_api_key: "Ключ AISStream не настроен",
  connect_failed: "Не удалось подключиться к источнику",
  provider_error: "Источник вернул ошибку",
  disconnected: "Соединение с источником разорвано",
  internal: "Внутренняя ошибка сервера",
};

function initialBearing(from: LatLon, to: LatLon): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const toDegrees = (radians: number) => (radians * 180) / Math.PI;
  const [lat1, lon1] = from.map(toRadians);
  const [lat2, lon2] = to.map(toRadians);
  const deltaLon = lon2 - lon1;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function createInitialVessels(timestamp: string): DemoVessel[] {
  return VESSEL_CONFIG.map((config: VesselConfig) => ({
    ...config,
    lat: config.route[0][0],
    lon: config.route[0][1],
    courseDeg: initialBearing(config.route[0], config.route[1]),
    timestamp,
    source: "demo",
    routeIndex: 0,
    stopped: false,
  }));
}

function advanceVessel(vessel: DemoVessel, timestamp: string): DemoVessel {
  if (vessel.stopped) return vessel;

  const nextIndex = vessel.routeIndex + 1;
  const [lat, lon] = vessel.route[nextIndex];
  const courseDeg = initialBearing(vessel.route[vessel.routeIndex], vessel.route[nextIndex]);
  const stopped = nextIndex === vessel.route.length - 1;

  return {
    ...vessel,
    lat,
    lon,
    courseDeg,
    speedKnots: stopped ? 0 : vessel.speedKnots,
    timestamp,
    routeIndex: nextIndex,
    stopped,
  };
}

function formatSpeed(speedKnots: number | null): string {
  if (speedKnots === null) return "Нет данных";
  return `${Number(speedKnots.toFixed(1))} уз`;
}

function formatCourse(courseDeg: number | null): string {
  if (courseDeg === null) return "Нет данных";
  return `${Math.round(courseDeg) % 360}°`;
}

function formatTimestamp(timestamp: string | null): string {
  if (timestamp === null) return "Нет данных";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Нет данных";
  return `${date.toISOString().slice(11, 19)} UTC`;
}

function formatSource(source: DisplayVessel["source"]): string {
  return source === "demo" ? "Демонстрационные данные" : "AISStream";
}

function syncMarkers(
  L: typeof import("leaflet"),
  map: LeafletMap,
  markers: Map<string, Marker>,
  vessels: DisplayVessel[],
  onSelect: (id: string) => void,
) {
  const currentIds = new Set(vessels.map(({ id }) => id));
  for (const [id, marker] of markers) {
    if (!currentIds.has(id)) {
      marker.remove();
      markers.delete(id);
    }
  }

  for (const vessel of vessels) {
    const marker = markers.get(vessel.id);
    if (marker) {
      marker.setLatLng([vessel.lat, vessel.lon]);
      marker.setIcon(createVesselIcon(L, vessel));
      continue;
    }

    const newMarker = L.marker([vessel.lat, vessel.lon], { icon: createVesselIcon(L, vessel) })
      .addTo(map)
      .on("click", () => onSelect(vessel.id));
    markers.set(vessel.id, newMarker);
  }
}

function getApiErrorMessage(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = payload.error;
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = error.code;
      if (typeof code === "string" && code in API_ERROR_MESSAGES) {
        return API_ERROR_MESSAGES[code];
      }
    }
  }
  return API_ERROR_MESSAGES.internal;
}

export default function SeaMap() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<LeafletMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const vesselsRef = useRef<DisplayVessel[]>([]);
  const loadingRef = useRef(false);
  const centeredForAisRef = useRef(false);
  const [displayState, setDisplayState] = useState<DisplayState>("demo");
  const [vessels, setVessels] = useState<DisplayVessel[]>(() => createInitialVessels(""));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshotInfo, setSnapshotInfo] = useState<{
    collectedAt: string;
    count: number;
    truncated: boolean;
  } | null>(null);
  const [attemptResult, setAttemptResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const selectedVessel = vessels.find(({ id }) => id === selectedId) ?? null;

  useEffect(() => {
    vesselsRef.current = vessels;
  }, [vessels]);

  useEffect(() => {
    if (displayState !== "demo") return;

    const startedAt = new Date().toISOString();
    const startTimestamp = window.setTimeout(() => {
      setVessels((current) =>
        current.map((vessel) =>
          vessel.source === "demo" ? { ...vessel, timestamp: startedAt } : vessel,
        ),
      );
    }, 0);
    const timer = window.setInterval(() => {
      const timestamp = new Date().toISOString();
      setVessels((current) =>
        current.map((vessel) =>
          vessel.source === "demo" ? advanceVessel(vessel, timestamp) : vessel,
        ),
      );
    }, DEMO_TICK_MS);

    return () => {
      window.clearTimeout(startTimestamp);
      window.clearInterval(timer);
    };
  }, [displayState]);

  useEffect(() => {
    let disposed = false;
    let mapMarkers: Map<string, Marker> | null = null;

    async function initializeMap() {
      const L = await import("leaflet");
      if (disposed || !mapElement.current) return;

      leaflet.current = L;
      mapMarkers = new Map<string, Marker>();
      markers.current = mapMarkers;
      const map = L.map(mapElement.current, {
        center: MAP_CONFIG.center,
        zoom: MAP_CONFIG.zoom,
      });
      mapInstance.current = map;

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);
      syncMarkers(L, map, mapMarkers, vesselsRef.current, setSelectedId);
    }

    void initializeMap();

    return () => {
      disposed = true;
      mapMarkers?.forEach((marker) => marker.remove());
      mapMarkers?.clear();
      mapInstance.current?.remove();
      mapInstance.current = null;
      leaflet.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leaflet.current;
    const map = mapInstance.current;
    if (!L || !map) return;
    syncMarkers(L, map, markers.current, vessels, setSelectedId);
  }, [vessels]);

  async function loadRealPositions() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    setAttemptResult("Загрузка…");

    try {
      const response = await fetch("/api/snapshot", { cache: "no-store" });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        setAttemptResult("Попытка: не удалось получить данные: Нет ответа сервера");
        return;
      }

      if (typeof payload !== "object" || payload === null || !("ok" in payload)) {
        setAttemptResult("Попытка: не удалось получить данные: Нет ответа сервера");
        return;
      }

      if (!response.ok || payload.ok !== true) {
        const attemptedAt =
          typeof payload === "object" && payload !== null && "attemptedAt" in payload && typeof payload.attemptedAt === "string"
            ? payload.attemptedAt
            : null;
        const responseMessage =
          typeof payload === "object" && payload !== null && "error" in payload &&
          typeof payload.error === "object" && payload.error !== null && "message" in payload.error &&
          typeof payload.error.message === "string"
            ? payload.error.message
            : getApiErrorMessage(payload);
        setAttemptResult(
          attemptedAt
            ? `Попытка ${formatTimestamp(attemptedAt)}: не удалось получить данные: ${responseMessage}`
            : `Попытка: не удалось получить данные: ${responseMessage}`,
        );
        return;
      }

      const snapshot = payload as SnapshotSuccess;
      if (snapshot.vessels.length === 0 || snapshot.count === 0) {
        setAttemptResult(`Попытка ${formatTimestamp(snapshot.collectedAt)}: за время сбора позиции не получены`);
        return;
      }

      setVessels(snapshot.vessels);
      setSnapshotInfo({
        collectedAt: snapshot.collectedAt,
        count: snapshot.count,
        truncated: snapshot.truncated,
      });
      setDisplayState("ais");
      setSelectedId((current) =>
        current && snapshot.vessels.some(({ id }) => id === current) ? current : null,
      );
      setAttemptResult(`Попытка ${formatTimestamp(snapshot.collectedAt)}: получено судов: ${snapshot.count}`);
      if (!centeredForAisRef.current) {
        mapInstance.current?.setView(MAP_CONFIG.center, MAP_CONFIG.zoom);
        centeredForAisRef.current = true;
      }
    } catch {
      setAttemptResult("Попытка: не удалось получить данные: Нет ответа сервера");
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }

  const sourceLabel = displayState === "demo"
    ? "Демонстрационные данные"
    : `AISStream · снимок за 15 с · получен ${formatTimestamp(snapshotInfo!.collectedAt)} · судов: ${snapshotInfo!.count} · выборка неполная${snapshotInfo!.truncated ? " · остановлено на лимите 100" : ""}`;

  return (
    <main className="sea-radar">
      <div ref={mapElement} className="sea-radar__map" aria-label="Карта пролива Дувр" />
      <aside className="sea-radar__panel" aria-live="polite">
        <button
          className="sea-radar__button"
          type="button"
          disabled={isLoading}
          onClick={() => void loadRealPositions()}
        >
          Загрузить настоящие позиции
        </button>
        <p className="sea-radar__source">{sourceLabel}</p>
        {attemptResult && (
          <p className="sea-radar__message" role={isLoading ? "status" : "alert"}>
            {attemptResult}
          </p>
        )}
        <p className="sea-radar__message">После обновления страницы снова показываются демонстрационные данные</p>
        {selectedVessel && (
          <section className="vessel-card" aria-label="Карточка судна">
            <dl>
              <div><dt>Идентификатор</dt><dd>{selectedVessel.id}</dd></div>
              <div><dt>Название</dt><dd>{selectedVessel.name || "Нет данных"}</dd></div>
              <div>
                <dt>Координаты</dt>
                <dd>{`${selectedVessel.lat.toFixed(5)}, ${selectedVessel.lon.toFixed(5)}`}</dd>
              </div>
              <div><dt>Скорость</dt><dd>{formatSpeed(selectedVessel.speedKnots)}</dd></div>
              <div><dt>Курс</dt><dd>{formatCourse(selectedVessel.courseDeg)}</dd></div>
              <div><dt>Время последнего сообщения</dt><dd>{formatTimestamp(selectedVessel.timestamp)}</dd></div>
              <div><dt>Источник</dt><dd>{formatSource(selectedVessel.source)}</dd></div>
            </dl>
          </section>
        )}
      </aside>
    </main>
  );
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const escaped: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escaped[character];
  });
}

function createVesselIcon(L: typeof import("leaflet"), vessel: DisplayVessel) {
  const iconName = vessel.courseDeg === null ? "neutral" : "course";
  const rotation = iconName === "course" ? ` style="transform: rotate(${vessel.courseDeg}deg)"` : "";
  const vesselId = escapeAttribute(vessel.id);

  return L.divIcon({
    className: "vessel-icon-container",
    html: `<span class="vessel-icon vessel-icon--${iconName}" data-vessel-id="${vesselId}" data-icon="${iconName}"${rotation}></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

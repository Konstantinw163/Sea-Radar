"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";

type Vessel = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  speedKnots: number;
  courseDeg: number;
  timestamp: string;
  source: "demo";
  route: readonly (readonly [number, number])[];
  routeIndex: number;
  stopped: boolean;
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

function createInitialVessels(timestamp: string): Vessel[] {
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

function advanceVessel(vessel: Vessel, timestamp: string): Vessel {
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
  return `${new Date(timestamp).toISOString().slice(11, 19)} UTC`;
}

function formatSource(source: Vessel["source"]): string {
  return source === "demo" ? "Демонстрационные данные" : "AISStream";
}

export default function SeaMap() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<LeafletMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const [vessels, setVessels] = useState<Vessel[]>(() => createInitialVessels(""));
  const vesselsRef = useRef(vessels);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedVessel = vessels.find(({ id }) => id === selectedId) ?? null;

  useEffect(() => {
    vesselsRef.current = vessels;
  }, [vessels]);

  useEffect(() => {
    const startedAt = new Date().toISOString();
    const startTimestamp = window.setTimeout(() => {
      setVessels((current) => current.map((vessel) => ({ ...vessel, timestamp: startedAt })));
    }, 0);

    const timer = window.setInterval(() => {
      const timestamp = new Date().toISOString();
      setVessels((current) => current.map((vessel) => advanceVessel(vessel, timestamp)));
    }, DEMO_TICK_MS);

    return () => {
      window.clearTimeout(startTimestamp);
      window.clearInterval(timer);
    };
  }, []);

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

      for (const vessel of vesselsRef.current) {
        const icon = createVesselIcon(L, vessel);
        const marker = L.marker([vessel.lat, vessel.lon], { icon })
          .addTo(map)
          .on("click", () => setSelectedId(vessel.id));
        mapMarkers.set(vessel.id, marker);
      }
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
    if (!L) return;

    for (const vessel of vessels) {
      const marker = markers.current.get(vessel.id);
      if (!marker) continue;
      marker.setLatLng([vessel.lat, vessel.lon]);
      marker.setIcon(createVesselIcon(L, vessel));
    }
  }, [vessels]);

  return (
    <main className="sea-radar">
      <div ref={mapElement} className="sea-radar__map" aria-label="Карта пролива Дувр" />
      <aside className="sea-radar__panel" aria-live="polite">
        <p className="sea-radar__source">Демонстрационные данные</p>
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

function createVesselIcon(L: typeof import("leaflet"), vessel: Vessel) {
  const iconName = vessel.courseDeg === null ? "neutral" : "course";
  const rotation = iconName === "course" ? ` style="transform: rotate(${vessel.courseDeg}deg)"` : "";

  return L.divIcon({
    className: "vessel-icon-container",
    html: `<span class="vessel-icon vessel-icon--${iconName}" data-vessel-id="${vessel.id}" data-icon="${iconName}"${rotation}></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

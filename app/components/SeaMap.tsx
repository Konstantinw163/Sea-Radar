"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";

type Vessel = {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  speedKnots: number | null;
  courseDeg: number | null;
  timestamp: string;
  source: "demo" | "aisstream";
};

const MAP_CONFIG = {
  bounds: [
    [50.75, 0.95],
    [51.25, 1.95],
  ] as [[number, number], [number, number]],
  center: [51.0, 1.45] as [number, number],
  zoom: 10,
};

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
  const markerInstance = useRef<Marker | null>(null);
  const [selectedVessel, setSelectedVessel] = useState<Vessel | null>(null);

  useEffect(() => {
    let disposed = false;
    const demoVessel: Vessel = {
      id: "demo-1",
      name: "Демо-судно 1",
      lat: MAP_CONFIG.center[0],
      lon: MAP_CONFIG.center[1],
      speedKnots: null,
      courseDeg: null,
      timestamp: new Date().toISOString(),
      source: "demo",
    };

    async function initializeMap() {
      const L = await import("leaflet");
      if (disposed || !mapElement.current) return;

      const map = L.map(mapElement.current, {
        center: MAP_CONFIG.center,
        zoom: MAP_CONFIG.zoom,
      });
      mapInstance.current = map;

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);

      const iconName = demoVessel.courseDeg === null ? "neutral" : "course";
      const icon = L.divIcon({
        className: "vessel-icon-container",
        html: `<span class="vessel-icon vessel-icon--${iconName}" data-vessel-id="${demoVessel.id}" data-icon="${iconName}"${demoVessel.courseDeg === null ? "" : ` style="transform: rotate(${demoVessel.courseDeg}deg)"`}></span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      markerInstance.current = L.marker([demoVessel.lat, demoVessel.lon], { icon })
        .addTo(map)
        .on("click", () => setSelectedVessel(demoVessel));
    }

    void initializeMap();

    return () => {
      disposed = true;
      markerInstance.current?.remove();
      markerInstance.current = null;
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  return (
    <main className="sea-radar">
      <div ref={mapElement} className="sea-radar__map" aria-label="Карта пролива Дувр" />
      <aside className="sea-radar__panel" aria-live="polite">
        <p className="sea-radar__source">Демонстрационные данные</p>
        {selectedVessel && (
          <section className="vessel-card" aria-label="Карточка судна">
            <dl>
              <div><dt>Идентификатор</dt><dd>{selectedVessel.id}</dd></div>
              <div><dt>Название</dt><dd>{selectedVessel.name ?? "Нет данных"}</dd></div>
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

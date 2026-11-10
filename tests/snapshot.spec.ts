import { expect, test } from "@playwright/test";
import positionReportSample from "../data/samples/position-report.sample.json";
import { toAisVessel } from "../app/ais-vessel";

const AIS_VESSEL = {
  id: "275525000",
  name: "OPTIMUS",
  lat: 50.98557166666667,
  lon: 1.290155,
  speedKnots: 6.6,
  courseDeg: 228.3,
  timestamp: "2026-11-04T16:06:15.382Z",
  source: "aisstream",
};

const SNAPSHOT = {
  ok: true,
  vessels: [AIS_VESSEL],
  collectedAt: "2026-11-04T16:06:17.591Z",
  windowSeconds: 15,
  count: 1,
  truncated: false,
  reason: "window_elapsed",
};

async function blockMapTiles(page: import("@playwright/test").Page) {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
}

test("converts the live PositionReport sample", () => {
  expect(toAisVessel(positionReportSample)).toEqual(AIS_VESSEL);
});

test("rejects invalid positions and preserves zero speed", () => {
  const invalidPosition = structuredClone(positionReportSample);
  invalidPosition.Message.PositionReport.Latitude = 91;
  expect(toAisVessel(invalidPosition)).toBeNull();

  const invalidTimestamp = structuredClone(positionReportSample);
  invalidTimestamp.MetaData.time_utc = "not a timestamp";
  expect(toAisVessel(invalidTimestamp)).toBeNull();

  const stationaryVessel = structuredClone(positionReportSample);
  stationaryVessel.Message.PositionReport.Sog = 0;
  stationaryVessel.Message.PositionReport.Cog = 360;
  expect(toAisVessel(stationaryVessel)).toMatchObject({ speedKnots: 0, courseDeg: null });

  const unavailableMotion = structuredClone(positionReportSample);
  unavailableMotion.Message.PositionReport.Sog = 102.3;
  unavailableMotion.Message.PositionReport.Cog = -1;
  expect(toAisVessel(unavailableMotion)).toMatchObject({ speedKnots: null, courseDeg: null });
});

test("loads an AIS snapshot, disables the button while loading, and shows its card", async ({ page }) => {
  await blockMapTiles(page);
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requestCount = 0;

  await page.route("**/api/snapshot", async (route) => {
    requestCount += 1;
    await responseGate;
    await route.fulfill({ status: 200, json: SNAPSHOT });
  });
  await page.goto("/");

  const button = page.getByRole("button", { name: "Загрузить настоящие позиции" });
  await expect(page.locator("[data-vessel-id]")).toHaveCount(3);
  await button.click();
  await expect(page.getByText("Загрузка…")).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(page.locator("[data-vessel-id]")).toHaveCount(3);

  releaseResponse();
  await expect(page.getByText("AISStream · снимок за 15 с · получен 16:06:17 UTC · судов: 1 · выборка неполная")).toBeVisible();
  const marker = page.locator('[data-vessel-id="275525000"]');
  await expect(marker).toHaveCount(1);
  await marker.click();

  const card = page.getByRole("region", { name: "Карточка судна" });
  await expect(card).toBeVisible();
  await expect(card.locator("dd").nth(0)).toHaveText("275525000");
  await expect(card.locator("dd").nth(1)).toHaveText("OPTIMUS");
  await expect(card.locator("dd").nth(2)).toHaveText("50.98557, 1.29015");
  await expect(card.locator("dd").nth(3)).toHaveText("6.6 уз");
  await expect(card.locator("dd").nth(4)).toHaveText("228°");
  await expect(card.locator("dd").nth(5)).toHaveText("16:06:15 UTC");
  await expect(card.locator("dd").nth(6)).toHaveText("AISStream");
  expect(requestCount).toBe(1);
});

test("empty snapshot preserves demo vessels and reports the attempt separately", async ({ page }) => {
  await blockMapTiles(page);
  await page.route("**/api/snapshot", async (route) => {
    await route.fulfill({
      status: 200,
      json: { ...SNAPSHOT, vessels: [], count: 0 },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Загрузить настоящие позиции" }).click();
  await expect(page.locator(".sea-radar__source")).toHaveText("Демонстрационные данные");
  await expect(page.locator(".sea-radar__message").first()).toHaveText("Попытка 16:06:17 UTC: за время сбора позиции не получены");
  await expect(page.locator("[data-vessel-id]")).toHaveCount(3);
});

test("no-key error preserves demo vessels and reports the attempt", async ({ page }) => {
  await blockMapTiles(page);
  await page.route("**/api/snapshot", async (route) => {
    await route.fulfill({
      status: 502,
      json: {
        ok: false,
        attemptedAt: "2026-11-04T16:06:17.591Z",
        error: { code: "no_api_key", message: "Ключ AISStream не настроен" },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Загрузить настоящие позиции" }).click();
  await expect(page.locator(".sea-radar__source")).toHaveText("Демонстрационные данные");
  await expect(page.locator(".sea-radar__message").first()).toHaveText("Попытка 16:06:17 UTC: не удалось получить данные: Ключ AISStream не настроен");
  await expect(page.locator("[data-vessel-id]")).toHaveCount(3);
});

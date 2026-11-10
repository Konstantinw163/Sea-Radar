import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

type TestVessel = {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  speedKnots: number | null;
  courseDeg: number | null;
  timestamp: string;
  source: "aisstream";
};

const AIS_VESSEL: TestVessel = {
  id: "r3-neutral-1",
  name: "R3 synthetic vessel",
  lat: 51.12345,
  lon: 1.54321,
  speedKnots: null,
  courseDeg: null,
  timestamp: "2026-11-04T16:06:15.382Z",
  source: "aisstream",
};

const SNAPSHOT_TIME = "2026-11-04T12:00:00.000Z";
const FOLLOWUP_TIME = "2026-11-04T12:01:00.000Z";

function snapshot(vessels: TestVessel[], collectedAt = SNAPSHOT_TIME, truncated = false) {
  return {
    ok: true,
    vessels,
    collectedAt,
    windowSeconds: 15,
    count: vessels.length,
    truncated,
    reason: "window_elapsed",
  };
}

async function preparePage(page: Page) {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
}

async function installClock(page: Page) {
  await page.clock.install({ time: new Date("2026-11-04T11:59:59.000Z") });
  await page.clock.pauseAt(new Date("2026-11-04T12:00:00.000Z"));
}

test("demo movement updates the selected card and stops at the route end", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-09T11:59:59.000Z") });
  await page.clock.pauseAt(new Date("2026-11-09T12:00:00.000Z"));
  await preparePage(page);
  await page.goto("/");
  await expect(page.locator('[data-vessel-id="demo-1"]')).toBeVisible();
  await page.locator('[data-vessel-id="demo-1"]').click();
  const card = page.getByRole("region", { name: "Карточка судна" });
  await expect(card.locator("dd").nth(2)).toHaveText("51.00000, 1.45000");

  await page.clock.runFor(6000);
  await expect(card.locator("dd").nth(2)).toHaveText("51.03000, 1.54000");
  await expect(card.locator("dd").first()).toHaveText("demo-1");

  await page.clock.runFor(12000);
  await expect(card.locator("dd").nth(2)).toHaveText("51.09000, 1.72000");
  await expect(card.locator("dd").nth(3)).toHaveText("0 уз");
  await expect(card.locator("dd").nth(4)).toHaveText("62°");
  await expect(card.locator("dd").nth(5)).toHaveText("12:00:18 UTC");

  await page.clock.fastForward(10000);
  await expect(card.locator("dd").nth(2)).toHaveText("51.09000, 1.72000");
  await expect(card.locator("dd").nth(5)).toHaveText("12:00:18 UTC");
});

test("non-empty success replaces demo, labels response time, and stops motion", async ({ page }) => {
  await installClock(page);
  await preparePage(page);
  await page.route("**/api/snapshot", (route) => route.fulfill({
    status: 200,
    json: snapshot([AIS_VESSEL]),
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Загрузить настоящие позиции" }).click();
  await expect(page.locator('[data-vessel-id="r3-neutral-1"]')).toBeVisible();
  await expect(page.locator(".sea-radar__source")).toContainText("получен 12:00:00 UTC");
  await expect(page.locator(".sea-radar__message").first()).toHaveText("Попытка 12:00:00 UTC: получено судов: 1");
  await page.clock.runFor(10000);
  await expect(page.locator('[data-vessel-id="r3-neutral-1"]')).toBeVisible();
  await expect(page.locator('[data-vessel-id="demo-1"]')).toHaveCount(0);
});

test("pending attempt preserves the displayed set and disables the button", async ({ page }) => {
  await preparePage(page);
  let finishRequest!: () => void;
  const responseReady = new Promise<void>((resolve) => { finishRequest = resolve; });
  await page.route("**/api/snapshot", async (route) => {
    await responseReady;
    await route.fulfill({ status: 200, json: snapshot([AIS_VESSEL]) });
  });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Загрузить настоящие позиции" });
  await button.click();
  await expect(button).toBeDisabled();
  await expect(page.locator(".sea-radar__message").first()).toHaveText("Загрузка…");
  await expect(page.locator(".sea-radar__source")).toHaveText("Демонстрационные данные");
  await expect(page.locator("[data-vessel-id]")).toHaveCount(3);
  finishRequest();
  await expect(page.locator('[data-vessel-id="r3-neutral-1"]')).toBeVisible();
});

test("empty response after success preserves prior vessels and freshness label", async ({ page }) => {
  await preparePage(page);
  let attempt = 0;
  await page.route("**/api/snapshot", (route) => {
    attempt += 1;
    return route.fulfill({
      status: 200,
      json: attempt === 1
        ? snapshot([AIS_VESSEL])
        : { ...snapshot([], FOLLOWUP_TIME), count: 0 },
    });
  });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Загрузить настоящие позиции" });
  await button.click();
  await expect(page.locator('[data-vessel-id="r3-neutral-1"]')).toBeVisible();
  await button.click();
  await expect(page.locator(".sea-radar__source")).toContainText("получен 12:00:00 UTC");
  await expect(page.locator(".sea-radar__message").first()).toHaveText("Попытка 12:01:00 UTC: за время сбора позиции не получены");
  await expect(page.locator('[data-vessel-id="r3-neutral-1"]')).toBeVisible();
});

test("error after success preserves prior vessels and source label", async ({ page }) => {
  await preparePage(page);
  let attempt = 0;
  await page.route("**/api/snapshot", (route) => {
    attempt += 1;
    return route.fulfill(attempt === 1
      ? { status: 200, json: snapshot([AIS_VESSEL]) }
      : { status: 502, json: { ok: false, attemptedAt: FOLLOWUP_TIME, error: { code: "provider_error", message: "Источник вернул ошибку" } } });
  });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Загрузить настоящие позиции" });
  await button.click();
  await expect(page.locator('[data-vessel-id="r3-neutral-1"]')).toBeVisible();
  await button.click();
  await expect(page.locator(".sea-radar__source")).toContainText("получен 12:00:00 UTC");
  await expect(page.locator(".sea-radar__message").first()).toHaveText("Попытка 12:01:00 UTC: не удалось получить данные: Источник вернул ошибку");
  await expect(page.locator('[data-vessel-id="r3-neutral-1"]')).toBeVisible();
});

test("error while showing demo keeps demo movement and labels the attempt", async ({ page }) => {
  await installClock(page);
  await preparePage(page);
  await page.route("**/api/snapshot", (route) => route.fulfill({
    status: 502,
    json: { ok: false, attemptedAt: SNAPSHOT_TIME, error: { code: "provider_error", message: "Источник вернул ошибку" } },
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Загрузить настоящие позиции" }).click();
  await expect(page.locator(".sea-radar__source")).toHaveText("Демонстрационные данные");
  await expect(page.locator(".sea-radar__message").first()).toHaveText("Попытка 12:00:00 UTC: не удалось получить данные: Источник вернул ошибку");
  await page.clock.runFor(6000);
  await page.locator('[data-vessel-id="demo-1"]').click();
  await expect(page.getByRole("region", { name: "Карточка судна" }).locator("dd").nth(2)).toHaveText("51.03000, 1.54000");
});

test("selected vessel updates when present and card closes when absent", async ({ page }) => {
  await preparePage(page);
  let attempt = 0;
  const updatedVessel = { ...AIS_VESSEL, lat: 51.2, lon: 1.7, timestamp: "2026-11-04T12:00:30.000Z" };
  await page.route("**/api/snapshot", (route) => {
    attempt += 1;
    const vessels = attempt === 1 ? [AIS_VESSEL] : attempt === 2 ? [updatedVessel] : [{ ...updatedVessel, id: "other-vessel" }];
    return route.fulfill({ status: 200, json: snapshot(vessels, attempt === 1 ? SNAPSHOT_TIME : FOLLOWUP_TIME) });
  });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Загрузить настоящие позиции" });
  await button.click();
  await page.locator('[data-vessel-id="r3-neutral-1"]').click();
  await button.click();
  const card = page.getByRole("region", { name: "Карточка судна" });
  await expect(card.locator("dd").nth(2)).toHaveText("51.20000, 1.70000");
  await expect(card.locator("dd").nth(5)).toHaveText("12:00:30 UTC");

  await button.click();
  await expect(card).toHaveCount(0);
});

test("null speed and course show no data and a neutral icon", async ({ page }) => {
  await preparePage(page);
  await page.route("**/api/snapshot", (route) => route.fulfill({
    status: 200,
    json: snapshot([AIS_VESSEL]),
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Загрузить настоящие позиции" }).click();
  const marker = page.locator('[data-vessel-id="r3-neutral-1"]');
  await expect(marker).toHaveAttribute("data-icon", "neutral");
  await marker.click();
  const card = page.getByRole("region", { name: "Карточка судна" });
  await expect(card.locator("dd").nth(3)).toHaveText("Нет данных");
  await expect(card.locator("dd").nth(4)).toHaveText("Нет данных");
});

test("truncated success shows the collection limit in source label", async ({ page }) => {
  await preparePage(page);
  const hundredVessels = Array.from({ length: 100 }, (_, index) => ({
    ...AIS_VESSEL,
    id: `ship-${index}`,
    speedKnots: 1,
    courseDeg: 20,
  }));
  await page.route("**/api/snapshot", (route) => route.fulfill({
    status: 200,
    json: snapshot(hundredVessels, SNAPSHOT_TIME, true),
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Загрузить настоящие позиции" }).click();
  await expect(page.locator(".sea-radar__source")).toContainText(" · остановлено на лимите 100");
});

test("real vessels remain stationary as browser time advances", async ({ page }) => {
  await installClock(page);
  await preparePage(page);
  await page.route("**/api/snapshot", (route) => route.fulfill({
    status: 200,
    json: snapshot([AIS_VESSEL]),
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Загрузить настоящие позиции" }).click();
  const marker = page.locator('[data-vessel-id="r3-neutral-1"]');
  const initialPosition = await marker.boundingBox();
  await page.clock.runFor(12000);
  const finalPosition = await marker.boundingBox();
  expect(finalPosition).toEqual(initialPosition);
});

test("second success leaves the user's map view unchanged", async ({ page }) => {
  await preparePage(page);
  let attempt = 0;
  await page.route("**/api/snapshot", (route) => {
    attempt += 1;
    return route.fulfill({ status: 200, json: snapshot([AIS_VESSEL], attempt === 1 ? SNAPSHOT_TIME : FOLLOWUP_TIME) });
  });
  await page.goto("/");
  const map = page.locator(".sea-radar__map");
  await page.getByRole("button", { name: "Загрузить настоящие позиции" }).click();
  await expect(page.locator('[data-vessel-id="r3-neutral-1"]')).toBeVisible();
  const before = await map.evaluate((element) => {
    const pane = element.querySelector(".leaflet-map-pane");
    return pane?.getAttribute("style") ?? "";
  });
  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.mouse.move(620, 430);
  await page.mouse.up();
  const shifted = await map.evaluate((element) => {
    const pane = element.querySelector(".leaflet-map-pane");
    return pane?.getAttribute("style") ?? "";
  });
  expect(shifted).not.toBe(before);
  await page.getByRole("button", { name: "Загрузить настоящие позиции" }).click();
  await expect(page.locator(".sea-radar__message").first()).toHaveText("Попытка 12:01:00 UTC: получено судов: 1");
  const after = await map.evaluate((element) => {
    const pane = element.querySelector(".leaflet-map-pane");
    return pane?.getAttribute("style") ?? "";
  });
  expect(after).toBe(shifted);
});

test("missing or invalid response body shows the no-server-response result", async ({ page }) => {
  await preparePage(page);
  await page.route("**/api/snapshot", (route) => route.fulfill({ status: 502, body: "" }));
  await page.goto("/");
  await page.getByRole("button", { name: "Загрузить настоящие позиции" }).click();
  await expect(page.locator(".sea-radar__message").first()).toHaveText("Попытка: не удалось получить данные: Нет ответа сервера");
  await expect(page.locator("[data-vessel-id]")).toHaveCount(3);
  await expect(page.locator(".sea-radar__source")).toHaveText("Демонстрационные данные");
});

test("reload hint is always present", async ({ page }) => {
  await preparePage(page);
  await page.goto("/");
  await expect(page.getByText("После обновления страницы снова показываются демонстрационные данные")).toBeVisible();
});

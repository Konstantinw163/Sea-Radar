import { expect, test } from "@playwright/test";

const AIS_VESSEL = {
  id: "r3-neutral-1",
  name: "R3 synthetic vessel",
  lat: 51.12345,
  lon: 1.54321,
  speedKnots: null,
  courseDeg: null,
  timestamp: "2026-11-04T16:06:15.382Z",
  source: "aisstream",
};

async function preparePage(page: import("@playwright/test").Page) {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
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

test("R2 snapshot error clears vessels and shows the fixed message", async ({ page }) => {
  await preparePage(page);
  await page.route("**/api/snapshot", (route) => route.fulfill({
    status: 502,
    json: { ok: false, attemptedAt: "2026-11-04T16:06:17.591Z", error: { code: "provider_error", message: "Источник вернул ошибку" } },
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Загрузить настоящие позиции" }).click();
  await expect(page.locator("[data-vessel-id]")).toHaveCount(0);
  await expect(page.getByText("Данных на карте нет")).toBeVisible();
  await expect(page.getByText("Не удалось получить данные: Источник вернул ошибку")).toBeVisible();
});

test("R2 empty snapshot reports zero collected positions", async ({ page }) => {
  await preparePage(page);
  await page.route("**/api/snapshot", (route) => route.fulfill({
    status: 200,
    json: { ok: true, vessels: [], collectedAt: "2026-11-04T16:06:17.591Z", windowSeconds: 15, count: 0, truncated: false, reason: "window_elapsed" },
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Загрузить настоящие позиции" }).click();
  await expect(page.getByText(/судов: 0/)).toBeVisible();
  await expect(page.getByText("За время сбора позиции не получены")).toBeVisible();
  await expect(page.locator("[data-vessel-id]")).toHaveCount(0);
});

test("R2 null speed and course show no data and a neutral icon", async ({ page }) => {
  await preparePage(page);
  await page.route("**/api/snapshot", (route) => route.fulfill({
    status: 200,
    json: { ok: true, vessels: [AIS_VESSEL], collectedAt: "2026-11-04T16:06:17.591Z", windowSeconds: 15, count: 1, truncated: false, reason: "window_elapsed" },
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

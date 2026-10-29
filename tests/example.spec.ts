import { expect, test } from "@playwright/test";

test("selects a vessel and keeps its card open on repeated click", async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/");

  const markers = page.locator("[data-vessel-id]");
  await expect(markers).toHaveCount(3);

  const marker = page.locator('[data-vessel-id="demo-1"]');
  await marker.click();

  const card = page.getByRole("region", { name: "Карточка судна" });
  await expect(card).toBeVisible();
  await expect(card.locator("dd").first()).toHaveText("demo-1");

  await marker.click();
  await expect(card).toBeVisible();
  await expect(card.locator("dd").first()).toHaveText("demo-1");
});

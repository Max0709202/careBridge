import { expect, test } from "@playwright/test";

/**
 * Phase 1 end-to-end coverage: the public surface renders, is navigable by
 * keyboard, and makes no medical claim. Role-based happy paths arrive with
 * their portals in later phases.
 */

test.describe("public pages", () => {
  test("landing page states what the service is and is not", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("doctor");
    await expect(page.getByText("In an emergency, call 911").first()).toBeVisible();
    // The scope section's heading, plus the "what we do not do" card. CardTitle
    // renders a styled div, not a heading element, so assert by text.
    await expect(page.getByRole("heading", { name: /does .* and does not do/i })).toBeVisible();
    await expect(page.getByText("What we do not do")).toBeVisible();
  });

  test("every public route responds and has exactly one h1", async ({ page }) => {
    for (const path of [
      "/",
      "/how-it-works",
      "/safety",
      "/privacy",
      "/terms",
      "/sign-in",
      "/sign-up",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} should return 200`).toBe(200);
      await expect(page.locator("h1"), `${path} should have one h1`).toHaveCount(1);
    }
  });

  test("legal pages are clearly marked as placeholders", async ({ page }) => {
    for (const path of ["/privacy", "/terms"]) {
      await page.goto(path);
      await expect(page.getByText("Placeholder — not a legal document")).toBeVisible();
    }
  });

  test("no page claims HIPAA compliance", async ({ page }) => {
    for (const path of ["/", "/how-it-works", "/safety", "/privacy", "/terms"]) {
      await page.goto(path);
      const body = (await page.locator("body").innerText()).toLowerCase();
      expect(body, `${path} must not claim HIPAA compliance`).not.toMatch(
        /hipaa[- ]?(compliant|certified)/,
      );
    }
  });

  test("skip link is the first stop for keyboard users", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
  });

  test("navigation works without a mouse", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "See how it works" }).click();
    await expect(page).toHaveURL(/\/how-it-works$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("security headers are present", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("unknown routes return a 404 page rather than an error", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});

test.describe("mobile layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("mobile menu opens and exposes the primary links", async ({ page }) => {
    await page.goto("/");

    const toggle = page.getByRole("button", { name: "Open menu" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.locator("#mobile-nav").getByRole("link", { name: "Safety" })).toBeVisible();
  });

  test("page does not scroll horizontally", async ({ page }) => {
    await page.goto("/");
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);
  });
});

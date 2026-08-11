import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import {
  startFixtureServer,
  type FixtureServer,
} from "../benchmark/fixture/server.js";

describe("create-ticket fixture", () => {
  let browser: Browser;
  let fixture: FixtureServer;

  beforeAll(async () => {
    fixture = await startFixtureServer(0);
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    const closeBrowser = browser.close().catch(() => undefined);
    await Promise.race([
      closeBrowser,
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
    await fixture.close();
  });

  it("reaches the benchmark postcondition deterministically", async () => {
    const page = await browser.newPage();
    await page.goto(fixture.url);

    await page.getByLabel("Title").fill("Payment button fails on checkout");
    await page.getByLabel("Priority").selectOption("High");
    await page.getByLabel("Include diagnostics").check();
    await page.getByRole("button", { name: "Create ticket" }).click();

    const result = page.getByRole("status");
    await expect(result.textContent()).resolves.toContain("Ticket T-1001 created");
    await expect(result.textContent()).resolves.toContain("Priority: High");
    await expect(result.textContent()).resolves.toContain("Diagnostics: included");

    await page.close();
  });
});

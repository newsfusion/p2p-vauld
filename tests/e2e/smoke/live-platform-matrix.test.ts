import { expect, test } from "../fixtures/extension.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type LivePlatform = {
  id: string;
  name: string;
};

const platformCatalog = JSON.parse(
  readFileSync(resolve("src/shared/platforms/platform-catalog.json"), "utf8"),
) as Array<LivePlatform & { enabled?: boolean }>;

const requestedPlatformIds = (process.env.P2P_LIVE_PLATFORMS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const platformById = new Map(
  platformCatalog
    .filter((platform) => platform.enabled !== false)
    .map((platform) => [platform.id, platform]),
);
const livePlatforms = requestedPlatformIds
  .map((platformId) => platformById.get(platformId))
  .filter((platform): platform is NonNullable<typeof platform> => Boolean(platform));

test.describe("Env-gated live platform matrix", () => {
  test.skip(livePlatforms.length === 0, "Set P2P_LIVE_PLATFORMS to run live platform checks.");

  for (const platform of livePlatforms) {
    test(`syncs or reports a clear live status for ${platform.name}`, async ({
      dashboardPage: page,
    }) => {
      const envPrefix = `P2P_${platform.id.toUpperCase()}_`;
      const username = process.env[`${envPrefix}USERNAME`];
      const password = process.env[`${envPrefix}PASSWORD`];
      test.skip(!username || !password, `Missing ${envPrefix}USERNAME or ${envPrefix}PASSWORD`);

      const invisibleKey = page.getByText("Use Invisible Key");
      if (await invisibleKey.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await invisibleKey.click();
        await page.getByRole("button", { name: "Continue" }).click();
      }

      await page.getByRole("button", { name: "Settings" }).click();
      await page.getByRole("combobox", { name: "Platform" }).fill(platform.name.slice(0, 4));
      await page.getByRole("option", { name: platform.name }).click();
      await page.getByLabel("Username / Email").fill(username!);
      await page.getByLabel("Password").fill(password!);
      await page.getByRole("button", { name: "Connect platform" }).click();
      await expect(page.getByText("Credentials saved securely.")).toBeVisible({ timeout: 10_000 });

      await page.getByRole("button", { name: "Settings" }).click();
      await page.getByRole("switch", { name: "Debug Mode" }).click();
      await page.getByRole("button", { name: "Portfolio" }).click();
      await page.getByRole("button", { name: /^Sync$/ }).click();

      const row = page.getByRole("row", { name: new RegExp(platform.name, "i") });
      await expect(
        row.getByText(/Done|Login failed|Manual action required|Captcha timeout|Platform offline|Extract failed/i),
      ).toBeVisible({ timeout: 120_000 });

      await page.getByRole("button", { name: "Debug" }).click();
      await expect(page.getByText(platform.name)).toBeVisible();
    });
  }
});

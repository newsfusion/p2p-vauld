import { expect, test } from "@playwright/test";

test.describe("Debug to extractor transfer", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const listeners = new Set<(message: unknown) => void>();
      const runtime = {
        sendMessage: async (message: { type?: string }) => {
          switch (message.type) {
            case "GET_LOCK_STATUS":
              return { locked: false, hasMasterPassword: false };
            case "GET_METRICS":
              return { metrics: [] };
            case "GET_CREDENTIAL_STATUS":
              return { platformIds: ["mintos"], credentials: [] };
            case "GET_SETTINGS":
              return {
                settings: {
                  privacyModeEnabled: false,
                  stealthModeEnabled: false,
                  debugModeEnabled: true,
                  disabledPlatformIds: [],
                  lastUsedCredentialEmail: "",
                  language: "en",
                  autoLockEnabled: false,
                  sessionTimeoutMinutes: 15,
                  historyRetentionDays: 0,
                  geminiActivationBannerDismissed: false,
                },
              };
            case "GET_SYNC_STATUS":
              return { run: undefined };
            case "GET_GEMINI_STATUS":
              return { status: "unavailable" };
            default:
              return {};
          }
        },
        onMessage: {
          addListener: (listener: (message: unknown) => void) => {
            listeners.add(listener);
          },
          removeListener: (listener: (message: unknown) => void) => {
            listeners.delete(listener);
          },
        },
      };

      (window as any).chrome = {
        runtime: runtime as any,
        storage: {
          local: {
            get: async () => ({ p2p_onboarding_complete: true }),
            set: async () => undefined,
          } as any,
        },
      };
    });

    await page.goto("/dashboard.html");
    await expect(
      page.getByRole("button", { name: "Portfolio" }),
    ).toBeVisible();
  });

  test("transfers captured login HTML into the login extractor tab", async ({
    page,
  }) => {
    await page.evaluate(async () => {
      // @ts-expect-error Exposed on window for E2E tests
      window.useDashboardStore.setState({
        debugMode: true,
        view: "debug",
        debugSnapshots: [
          {
            platformId: "mintos",
            platformName: "Mintos",
            timestamp: "2026-05-25T12:00:00.000Z",
            signals: [],
            loginSuccess: true,
            logs: [],
            rawLoginHtml: "<html><body>Transferred Login HTML</body></html>",
            rawHtml: "<html><body>Transferred Dashboard HTML</body></html>",
          },
        ],
      });
    });

    await expect(page.getByText("Login Page HTML")).toBeVisible();

    await page.getByTestId("send-to-extractor-login").click();

    await expect(
      page.getByRole("heading", { name: "Login Extractor" }),
    ).toBeVisible();
    await expect(page.getByText("Transferred HTML")).toBeVisible();
    await expect(page.getByText("Transferred Login HTML")).toBeVisible();
  });
});

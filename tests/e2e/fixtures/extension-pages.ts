import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export class ExtensionPage {
  constructor(
    public readonly page: Page,
    protected readonly extensionId: string,
  ) {}

  protected extensionUrl(path: string): string {
    return `chrome-extension://${this.extensionId}/${path.replace(/^\//, "")}`;
  }

  async bringToFrontWithCdp(): Promise<void> {
    const client = await this.page.context().newCDPSession(this.page);
    await client.send("Page.bringToFront");
    await client.detach();
  }
}

type LoginStateResponse = {
  loggedIn: boolean;
  requires2FA: boolean;
  requiresCaptcha: boolean;
  url: string;
};

export class ExtensionDashboardPage extends ExtensionPage {
  async open(): Promise<void> {
    await this.page.goto(this.extensionUrl("dashboard.html"));
  }

  async expectLoaded(): Promise<void> {
    await expect(
      this.page.getByRole("heading", { name: "Welcome to P2P Portfolio Tracker" }),
    ).toBeVisible();
    await expect(
      this.page.getByRole("button", { name: "Portfolio" }),
    ).toBeVisible();
  }

  async checkActiveTabLoginState(): Promise<LoginStateResponse> {
    return this.page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (!tab?.id) {
              reject(new Error("No active tab found"));
              return;
            }

            chrome.tabs.sendMessage(
              tab.id,
              {
                type: "CHECK_LOGIN",
                payload: {
                  postLoginIndicators: ["text=/dashboard/i"],
                  usernameSelectors: [
                    'input[type="email"]',
                    'input[name="email"]',
                    'input[autocomplete="username"]',
                  ],
                  passwordSelectors: [
                    'input[type="password"]',
                    'input[name="password"]',
                    'input[autocomplete="current-password"]',
                  ],
                  otpSelectors: [
                    'input[name="otp"]',
                    'input[name="code"]',
                    'input[autocomplete="one-time-code"]',
                  ],
                },
              },
              (response) => {
                const error = chrome.runtime.lastError;
                if (error) {
                  reject(new Error(error.message));
                  return;
                }
                resolve(response);
              },
            );
          });
        }),
    );
  }
}

export class ExtensionPopupPage extends ExtensionPage {
  async open(): Promise<void> {
    await this.page.goto(this.extensionUrl("popup.html"));
  }
}

export class PlatformContentPage {
  constructor(public readonly page: Page) {}

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async bringToFrontWithCdp(): Promise<void> {
    const client = await this.page.context().newCDPSession(this.page);
    await client.send("Page.bringToFront");
    await client.detach();
  }
}

export async function openExtensionDashboard(
  context: BrowserContext,
  extensionId: string,
): Promise<ExtensionDashboardPage> {
  const dashboard = new ExtensionDashboardPage(await context.newPage(), extensionId);
  await dashboard.open();
  return dashboard;
}

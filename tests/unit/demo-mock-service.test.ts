import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

type DemoMockServiceModule = {
  DEMO_ALL_PLATFORM_IDS: string[];
  DEMO_PLATFORM_IDS: string[];
  DEMO_DASHBOARD_TEMPLATES: Record<string, unknown>;
  createDemoState: () => Map<string, number>;
  getDemoValues: (
    platformId: string,
    stateIndex: number,
    date?: Date | null,
  ) => {
    portfolioValue: number;
    freeCash: number;
    netAnnualReturn: number;
  };
  renderLoginPage: (platformId: string) => string;
  renderCachedLoginPage: (
    platformId: string,
    options?: {
      cacheDir?: string;
      platformName?: string;
      sourceUrl?: string;
    },
  ) => string;
  renderDashboardPage: (
    platformId: string,
    stateIndex: number,
    date?: Date | null,
  ) => string;
  resetDemoState: (state: Map<string, number>) => void;
  getDynamicAdditions: (
    platformIndex: number,
    date?: Date | null,
  ) => {
    portfolioAddition: number;
    freeCashAddition: number;
  };
};

let demoMockService: DemoMockServiceModule;
let catalogPlatformCount: number;

beforeAll(async () => {
  const serviceUrl = pathToFileURL(
    join(process.cwd(), "scripts/demo-mock-service.mjs"),
  ).href;
  demoMockService = (await import(
    serviceUrl
  )) as DemoMockServiceModule;
  catalogPlatformCount = JSON.parse(
    readFileSync("src/shared/platforms/platform-catalog.json", "utf8"),
  ).length;
});

describe("demo mock service helpers", () => {
  it("exposes all catalog platforms and keeps the default cohort as the first ten", () => {
    expect(demoMockService.DEMO_ALL_PLATFORM_IDS).toHaveLength(catalogPlatformCount);
    expect(demoMockService.DEMO_PLATFORM_IDS).toEqual([
      "mintos",
      "bondora_go_grow",
      "peerberry",
      "robocash",
      "twino",
      "estateguru",
      "debitum",
      "esketit",
      "viainvest",
      "nectaro",
    ]);
    expect(demoMockService.DEMO_ALL_PLATFORM_IDS.slice(0, 10)).toEqual(
      demoMockService.DEMO_PLATFORM_IDS,
    );
  });

  it("renders the login fields expected by demo mode", () => {
    const html = demoMockService.renderLoginPage("mintos");

    expect(html).toContain('id="login-username"');
    expect(html).toContain('id="login-password"');
    expect(html).toContain('data-testid="login-button"');
    expect(html).toContain('action="/demo/mintos/authenticated"');
  });

  it("renders fallback cached login pages for platforms without local snapshots", () => {
    const html = demoMockService.renderCachedLoginPage("afranga", {
      cacheDir: "__missing_demo_login_cache__",
      platformName: "Afranga",
      sourceUrl: "https://afranga.com/",
    });

    expect(html).toContain('data-p2p-demo-login-cache="fallback"');
    expect(html).toContain("Afranga Login");
    expect(html).toContain('action="/demo/afranga/authenticated"');
  });

  it("changes dashboard values when state advances", () => {
    const first = demoMockService.getDemoValues("mintos", 0, null);
    const second = demoMockService.getDemoValues("mintos", 1, null);

    expect(second.portfolioValue).toBe(first.portfolioValue + 250);
    expect(second.freeCash).toBe(first.freeCash + 25);
    expect(second.netAnnualReturn).toBeCloseTo(first.netAnnualReturn + 0.03);

    expect(first.portfolioValue).toBe(4000);
    expect(second.portfolioValue).toBe(4250);
    expect(demoMockService.renderDashboardPage("mintos", 0, null)).toContain(
      "€4,000.00",
    );
    expect(demoMockService.renderDashboardPage("mintos", 1, null)).toContain(
      "€4,250.00",
    );
  });

  it("applies intentional portfolio baseline offsets for selected demo platforms", () => {
    expect(demoMockService.getDemoValues("mintos", 0, null).portfolioValue).toBe(
      4000,
    );
    expect(
      demoMockService.getDemoValues("peerberry", 0, null).portfolioValue,
    ).toBe(17000);
    expect(demoMockService.getDemoValues("debitum", 0, null).portfolioValue).toBe(
      12910,
    );
    expect(demoMockService.getDemoValues("esketit", 0, null).portfolioValue).toBe(
      3910,
    );
  });

  it("keeps dashboard HTML stable for the same platform and state", () => {
    for (const platformId of demoMockService.DEMO_ALL_PLATFORM_IDS) {
      expect(demoMockService.renderDashboardPage(platformId, 2, null)).toBe(
        demoMockService.renderDashboardPage(platformId, 2, null),
      );
    }
  });

  it("uses different dashboard structures across all demo platforms", () => {
    const structuralFingerprints = demoMockService.DEMO_PLATFORM_IDS.map(
      (platformId) =>
        demoMockService
          .renderDashboardPage(platformId, 0, null)
          .replace(/\d[\d.,]*/g, "NUMBER")
          .replace(/€|EUR|%/g, "UNIT"),
    );

    expect(new Set(structuralFingerprints).size).toBe(
      demoMockService.DEMO_PLATFORM_IDS.length,
    );
    expect(Object.keys(demoMockService.DEMO_DASHBOARD_TEMPLATES)).toEqual(
      demoMockService.DEMO_PLATFORM_IDS,
    );
  });

  it("renders portfolio, cash, and return values in every dashboard", () => {
    for (const platformId of demoMockService.DEMO_ALL_PLATFORM_IDS) {
      const values = demoMockService.getDemoValues(platformId, 0, null);
      const html = demoMockService.renderDashboardPage(platformId, 0, null);
      const visibleText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      const visibleDigits = visibleText.replace(/\D/g, "");

      expect(visibleDigits).toContain(String(values.portfolioValue));
      expect(visibleDigits).toContain(String(values.freeCash));
      expect(visibleDigits).toContain(
        String(Math.round(values.netAnnualReturn * 100)),
      );
    }
  });

  it("calculates dynamic additions based on time and platform index", () => {
    // 15:47 -> 1547.
    const testDate = new Date("2026-05-21T15:47:00");

    // Index 1 (bondora_go_grow)
    // 1547 + 1 on each digit -> 2658. Decimals -> 0.11. Portfolio Addition -> 2658.11. Free Cash -> 26.5811
    const additions1 = demoMockService.getDynamicAdditions(1, testDate);
    expect(additions1.portfolioAddition).toBeCloseTo(2658.11, 4);
    expect(additions1.freeCashAddition).toBeCloseTo(26.5811, 4);

    // Index 2 (peerberry)
    // 1547 + 2 on each digit -> 3769. Decimals -> 0.22. Portfolio Addition -> 3769.22. Free Cash -> 37.6922
    const additions2 = demoMockService.getDynamicAdditions(2, testDate);
    expect(additions2.portfolioAddition).toBeCloseTo(3769.22, 4);
    expect(additions2.freeCashAddition).toBeCloseTo(37.6922, 4);

    // Index 3 (robocash)
    // 1547 + 3 on each digit -> 4870 (7+3=10->0). Decimals -> 0.33. Portfolio Addition -> 4870.33. Free Cash -> 48.7033
    const additions3 = demoMockService.getDynamicAdditions(3, testDate);
    expect(additions3.portfolioAddition).toBeCloseTo(4870.33, 4);
    expect(additions3.freeCashAddition).toBeCloseTo(48.7033, 4);

    // Also verify getDemoValues utilizes these additions
    const values1 = demoMockService.getDemoValues("bondora_go_grow", 0, testDate);
    // Base portfolioValue for bondora_go_grow (Index 1) stateIndex 0: 11_000
    // Dynamic value: 11_000 + 2658.11 = 13658.11
    expect(values1.portfolioValue).toBeCloseTo(13658.11, 4);
    // Base freeCash: 500 + 1 * 50 = 550
    // Dynamic value: 550 + 26.5811 = 576.5811
    expect(values1.freeCash).toBeCloseTo(576.5811, 4);
  });

  it("resets platform counters", () => {
    const state = demoMockService.createDemoState();
    state.set("mintos", 3);
    state.set("peerberry", 4);

    demoMockService.resetDemoState(state);

    expect(state.get("mintos")).toBe(0);
    expect(state.get("peerberry")).toBe(0);
  });
});

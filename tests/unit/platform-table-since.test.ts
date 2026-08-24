import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformCatalog } from "../../src/shared/platforms/index.js";
import type {
  PlatformId,
  StoredIngestionBatch,
  StoredOverviewMetrics,
} from "../../src/shared/types/index.js";

const { sendBackgroundMock } = vi.hoisted(() => ({
  sendBackgroundMock: vi.fn(),
}));

vi.mock("../../src/shared/messages.js", () => ({
  sendBackground: sendBackgroundMock,
}));

import { PlatformTable } from "../../src/dashboard/components/PlatformTable.js";

const eur = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
  }).format(value);

const relativeHourAgo = (): string =>
  new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-1, "hour");

async function settleUi(): Promise<void> {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
}

async function waitForAssertion(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / 10));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await settleUi();
    }
  }
  assertion();
}

describe("PlatformTable Since column", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T12:00:00.000Z"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    sendBackgroundMock.mockReset();
    sendBackgroundMock.mockResolvedValue({ batches: [] });
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders downloaded local manifest icons before falling back to Chrome favicon URLs", () => {
    const platform = getPlatformCatalog().find((entry) => entry.id === "mintos");
    if (!platform) throw new Error("Mintos platform is missing");

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [],
          syncStates: { [platform.id]: "success" },
          syncSteps: {},
          privacyMode: false,
          isSyncing: false,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    const favicon = container.querySelector<HTMLImageElement>(
      '[data-testid="platform-favicon"]',
    );
    expect(favicon?.getAttribute("src")).toBe("/icons/platforms/mintos.png");
  });

  it("marks platform icons as syncing while their platform sync is active", () => {
    const platform = getPlatformCatalog().find((entry) => entry.id === "mintos");
    if (!platform) throw new Error("Mintos platform is missing");

    const renderTable = (syncState: "running" | "success") => {
      flushSync(() => {
        root.render(
          React.createElement(PlatformTable, {
            platforms: [platform],
            metrics: [],
            syncStates: { [platform.id]: syncState },
            syncSteps: {},
            privacyMode: false,
            isSyncing: syncState === "running",
            onSyncAll: vi.fn(),
            onAddPlatform: vi.fn(),
            onSyncPlatform: vi.fn(),
            onReportWrongImport: vi.fn(async () => undefined),
            onEditCredentials: vi.fn(),
          }),
        );
      });
    };

    renderTable("running");
    let iconFrame = container.querySelector('[data-testid="platform-favicon"]')
      ?.parentElement;
    expect(iconFrame?.className).toContain("platform-icon-syncing");

    renderTable("success");
    iconFrame = container.querySelector('[data-testid="platform-favicon"]')
      ?.parentElement;
    expect(iconFrame?.className).not.toContain("platform-icon-syncing");
  });

  it("keeps the sync-all button accessible label stable while reserving both visual labels", () => {
    const platform = getPlatformCatalog()[0];
    if (!platform) throw new Error("Platform catalog is empty");

    const renderTable = (isSyncing: boolean) => {
      flushSync(() => {
        root.render(
          React.createElement(PlatformTable, {
            platforms: [platform],
            metrics: [],
            syncStates: { [platform.id]: isSyncing ? "running" : "success" },
            syncSteps: {},
            privacyMode: false,
            isSyncing,
            onSyncAll: vi.fn(),
            onAddPlatform: vi.fn(),
            onSyncPlatform: vi.fn(),
            onReportWrongImport: vi.fn(async () => undefined),
            onEditCredentials: vi.fn(),
          }),
        );
      });
    };

    renderTable(false);
    let button = container.querySelector<HTMLButtonElement>(
      '[data-testid="platform-table-sync-all"]',
    );
    expect(button?.getAttribute("aria-label")).toBe("Sync All");
    expect(button?.querySelector('[data-testid="sync-all-labels"]')?.textContent).toBe(
      "Sync AllSyncing All",
    );

    renderTable(true);
    button = container.querySelector<HTMLButtonElement>(
      '[data-testid="platform-table-sync-all"]',
    );
    expect(button?.getAttribute("aria-label")).toBe("Syncing All");
    expect(button?.querySelector('[data-testid="sync-all-labels"]')?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("shows Since for Last Sync with english relative time and date tooltip", () => {
    const platform = getPlatformCatalog()[0];
    if (!platform) throw new Error("Platform catalog is empty");

    const metrics: StoredOverviewMetrics[] = [
      {
        platformId: platform.id,
        fetchedAt: "2026-03-09T11:00:00.000Z",
        platformValue: 1200,
        freeCash: 50,
        netAnnualReturnPct: 9.25,
        currency: "EUR",
        confidence: 0.9,
      },
    ];

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics,
          syncStates: { [platform.id]: "success" },
          syncSteps: {},
          privacyMode: false,
          isSyncing: false,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    const headers = Array.from(container.querySelectorAll("th")).map((header) =>
      header.textContent?.trim(),
    );
    expect(headers).toContain("Since");
    expect(headers).not.toContain("Last Sync");
    expect(headers).not.toContain("Confidence");

    const sinceCell = container.querySelector("tbody tr td:nth-child(6)");
    expect(sinceCell?.textContent).toContain(relativeHourAgo());
    expect(sinceCell?.getAttribute("title")).toBeTruthy();
    expect(sinceCell?.getAttribute("title")).not.toMatch(/:\d{2}:\d{2}/);
  });

  it("masks financial values in the DOM when privacy mode is enabled", () => {
    const platform = getPlatformCatalog()[0];
    if (!platform) throw new Error("Platform catalog is empty");

    const metrics: StoredOverviewMetrics[] = [
      {
        platformId: platform.id,
        fetchedAt: "2026-03-09T11:00:00.000Z",
        platformValue: 1234.56,
        freeCash: 78.9,
        netAnnualReturnPct: 9.25,
        currency: "EUR",
        confidence: 0.9,
      },
    ];

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics,
          syncStates: { [platform.id]: "success" },
          syncSteps: {},
          privacyMode: true,
          isSyncing: false,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    expect(container.textContent).toContain("****,** €");
    expect(container.textContent).toContain("**%");
    expect(container.textContent).not.toContain(eur(1234.56));
    expect(container.textContent).not.toContain(eur(78.9));
    expect(container.textContent).not.toContain("9.25");
    expect(container.textContent).not.toContain("1,234.56");
    expect(container.querySelector(".blur-sm")).toBeNull();

    const sinceCell = container.querySelector("tbody tr td:nth-child(6)");
    expect(sinceCell?.textContent).toContain(relativeHourAgo());
    expect(sinceCell?.getAttribute("title")).toBeTruthy();
  });

  it("shows queued state in live status column during sync", () => {
    const platform = getPlatformCatalog()[0];
    if (!platform) throw new Error("Platform catalog is empty");

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [],
          syncStates: { [platform.id]: "pending" },
          syncSteps: {},
          privacyMode: false,
          isSyncing: true,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    const statusCell = container.querySelector("tbody tr td:nth-child(2)");
    expect(statusCell?.textContent?.trim()).toBe("Queued");
  });

  it("shows queue position for queued platforms during sync", () => {
    const platform = getPlatformCatalog()[0];
    if (!platform) throw new Error("Platform catalog is empty");

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [],
          syncStates: { [platform.id]: "pending" },
          syncSteps: {},
          queuedPlatformIds: [platform.id],
          privacyMode: false,
          isSyncing: true,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    const statusCell = container.querySelector("tbody tr td:nth-child(2)");
    expect(statusCell?.textContent?.trim()).toBe("In Queue #1");
  });

  it("allows syncing another platform while one platform is already running", () => {
    const [runningPlatform, idlePlatform] = getPlatformCatalog();
    if (!runningPlatform || !idlePlatform) throw new Error("Need two platforms");
    const onSyncPlatform = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [runningPlatform, idlePlatform],
          metrics: [],
          syncStates: { [runningPlatform.id]: "running" },
          syncSteps: {},
          privacyMode: false,
          isSyncing: true,
          syncablePlatformIds: [runningPlatform.id, idlePlatform.id],
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform,
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("tbody tr td:last-child button"),
    );
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[1]?.disabled).toBe(false);

    buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onSyncPlatform).toHaveBeenCalledWith(idlePlatform.id);
  });

  it("shows imported-only platforms as read-only and routes to credentials", () => {
    const platform = getPlatformCatalog().find((entry) => entry.id === "mintos");
    if (!platform) throw new Error("Mintos platform is missing");
    const onEditCredentials = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [
            {
              platformId: "mintos",
              fetchedAt: "2026-03-09T11:00:00.000Z",
              platformValue: 1234.56,
              freeCash: 78.9,
              currency: "EUR",
              confidence: 0.9,
            },
          ],
          syncStates: {},
          syncSteps: {},
          privacyMode: false,
          isSyncing: false,
          syncablePlatformIds: [],
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials,
        }),
      );
    });

    expect(container.textContent).toContain("Imported data only");
    const rowSyncButton = Array.from(container.querySelectorAll("tbody button")).find(
      (button) => button.textContent?.trim() === "Sync",
    );
    expect(rowSyncButton).toBeUndefined();
    const addCredentials = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Add credentials"),
    );
    expect(addCredentials).toBeTruthy();
    addCredentials?.click();
    expect(onEditCredentials).toHaveBeenCalledWith("mintos");
  });

  it("shows running step text in live status column during sync", () => {
    const platform = getPlatformCatalog()[0];
    if (!platform) throw new Error("Platform catalog is empty");

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [],
          syncStates: { [platform.id]: "running" },
          syncSteps: { [platform.id]: "Opening dashboard..." },
          privacyMode: false,
          isSyncing: true,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    const statusCell = container.querySelector("tbody tr td:nth-child(2)");
    expect(statusCell?.textContent?.trim()).toBe("Opening dashboard...");
  });

  it("shows a warning badge for persisted suspect values", () => {
    const platform = getPlatformCatalog().find((entry) => entry.id === "mintos");
    if (!platform) throw new Error("Mintos platform is missing");

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [
            {
              platformId: "mintos",
              platformValue: 1200,
              freeCash: 50,
              currency: "EUR",
              confidence: 0.55,
              fetchedAt: "2026-06-10T10:00:00.000Z",
              warnings: ["suspect_value"],
            },
          ],
          syncStates: {},
          syncSteps: {},
          privacyMode: false,
          isSyncing: false,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    expect(container.textContent).toContain("Check value");
  });

  it("shows dash in live status column when not syncing", () => {
    const platform = getPlatformCatalog()[0];
    if (!platform) throw new Error("Platform catalog is empty");

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [],
          syncStates: { [platform.id]: "running" },
          syncSteps: { [platform.id]: "Extracting data..." },
          privacyMode: false,
          isSyncing: false,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    const statusCell = container.querySelector("tbody tr td:nth-child(2)");
    expect(statusCell?.textContent?.trim()).toBe("—");
  });

  it("marks an expanded platform row as selected and renders history in aligned detail cells", async () => {
    const platform = getPlatformCatalog()[0];
    if (!platform) throw new Error("Platform catalog is empty");
    const snapshots = [
      {
        platformId: platform.id,
        date: "2026-03-09",
        platformValue: 807.83,
        freeCash: 32.76,
        fetchedAt: "2026-03-09T11:00:00.000Z",
        currency: "EUR",
        confidence: 0.9,
        batchId: 31,
      },
    ];
    const batches: StoredIngestionBatch[] = [
      {
        id: 31,
        platformId: platform.id,
        sourceKind: "sync",
        appliedAt: "2026-03-09T11:00:00.000Z",
        revertible: true,
        legacyBackfilled: false,
        beforeOverview: {
          platformId: platform.id,
          platformValue: 775.07,
          freeCash: 1,
          fetchedAt: "2026-03-09T10:00:00.000Z",
        },
        afterOverview: {
          platformId: platform.id,
          platformValue: 807.83,
          freeCash: 32.76,
          fetchedAt: "2026-03-09T11:00:00.000Z",
        },
        afterDailySnapshot: snapshots[0]!,
        cashflowCount: 0,
        positionCount: 0,
        riskEventCount: 0,
      },
    ];
    sendBackgroundMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_METRICS_HISTORY") return { snapshots };
      return { batches };
    });

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [],
          syncStates: { [platform.id]: "success" },
          syncSteps: {},
          privacyMode: false,
          isSyncing: false,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      `button[aria-label="Toggle change history for ${platform.name}"]`,
    );
    expect(toggle).not.toBeNull();

    flushSync(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const rows = container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.className).toContain("bg-muted/70");

    await waitForAssertion(() => {
      expect(container.querySelectorAll("tbody tr")[1]?.querySelectorAll("td")).toHaveLength(7);
    });

    const detailCells = container.querySelectorAll("tbody tr")[1]?.querySelectorAll("td");
    expect(detailCells?.[2]?.textContent).toContain(eur(807.83));
    expect(detailCells?.[2]?.textContent).not.toContain("→");
    expect(detailCells?.[2]?.textContent).toContain(`+${eur(32.76)}`);
    expect(detailCells?.[2]?.textContent?.indexOf(`+${eur(32.76)}`)).toBeLessThan(
      detailCells?.[2]?.textContent?.indexOf(eur(807.83)) ?? 0,
    );
    expect(detailCells?.[3]?.textContent).toContain(eur(32.76));
    expect(detailCells?.[3]?.textContent).not.toContain("→");
    expect(detailCells?.[3]?.textContent).toContain(`+${eur(31.76)}`);
    expect(detailCells?.[3]?.textContent?.indexOf(`+${eur(31.76)}`)).toBeLessThan(
      detailCells?.[3]?.textContent?.indexOf(eur(32.76)) ?? 0,
    );
    expect(detailCells?.[4]?.textContent?.trim()).toBe("");
    expect(detailCells?.[5]?.textContent).toContain(relativeHourAgo());
    expect(detailCells?.[6]?.querySelector('[data-testid="history-edit-2026-03-09"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Recent Changes");
  });

  it("toggles change history when clicking anywhere on the platform row", () => {
    const platform = getPlatformCatalog()[0];
    if (!platform) throw new Error("Platform catalog is empty");
    sendBackgroundMock.mockResolvedValue({ batches: [] });

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [],
          syncStates: { [platform.id]: "success" },
          syncSteps: {},
          privacyMode: false,
          isSyncing: false,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    const platformRow = container.querySelector<HTMLTableRowElement>("tbody tr");
    const toggle = container.querySelector<HTMLButtonElement>(
      `button[aria-label="Toggle change history for ${platform.name}"]`,
    );
    expect(platformRow).not.toBeNull();
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    const controlsId = toggle?.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();

    flushSync(() => {
      platformRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(controlsId ?? "")).not.toBeNull();
    expect(container.textContent).not.toContain("Recent Changes");

    flushSync(() => {
      platformRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Recent Changes");
  });

  it("keeps sync button clicks from toggling change history", () => {
    const platform = getPlatformCatalog()[0];
    if (!platform) throw new Error("Platform catalog is empty");
    const onSyncPlatform = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [],
          syncStates: { [platform.id]: "success" },
          syncSteps: {},
          privacyMode: false,
          isSyncing: false,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform,
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    const syncButton = container.querySelector<HTMLButtonElement>("tbody tr td:last-child button");
    expect(syncButton).not.toBeNull();
    expect(syncButton?.className).toContain("border");
    expect(syncButton?.className).toContain("bg-card");
    expect(syncButton?.className).toContain("hover:text-slate-950");
    expect(syncButton?.className).not.toContain("hover:text-primary");

    flushSync(() => {
      syncButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSyncPlatform).toHaveBeenCalledWith(platform.id);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.textContent).not.toContain("Recent Changes");
  });

  it("renders a dynamic favicon URL for a platform using metadata websiteUrl", () => {
    const catalogPlatform = getPlatformCatalog()[0];
    if (!catalogPlatform) throw new Error("Platform catalog is empty");
    const platform = {
      ...catalogPlatform,
      id: "test_platform_without_local_icon" as PlatformId,
      login: {
        ...catalogPlatform.login,
        entryUrl: "https://example.test/login",
      },
    };

    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://test-extension${path}`,
      },
    });

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [],
          syncStates: { [platform.id]: "success" },
          syncSteps: {},
          privacyMode: false,
          isSyncing: false,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    const favicon = container.querySelector<HTMLImageElement>(
      'img[data-testid="platform-favicon"]',
    );

    expect(favicon).not.toBeNull();
    const faviconUrl = new URL(favicon?.getAttribute("src") ?? "");
    expect(faviconUrl.protocol).toBe("chrome-extension:");
    expect(faviconUrl.host).toBe("test-extension");
    expect(faviconUrl.pathname).toBe("/_favicon/");
    expect(faviconUrl.searchParams.get("pageUrl")).toBe(
      "https://example.test/login",
    );
    expect(faviconUrl.searchParams.get("size")).toBe("32");
  });

  it("falls back to initials when the dynamic favicon image fails", async () => {
    const platform = getPlatformCatalog()[0];
    if (!platform) throw new Error("Platform catalog is empty");

    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://test-extension${path}`,
      },
    });

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [],
          syncStates: { [platform.id]: "success" },
          syncSteps: {},
          privacyMode: false,
          isSyncing: false,
          onSyncAll: vi.fn(),
          onAddPlatform: vi.fn(),
          onSyncPlatform: vi.fn(),
          onReportWrongImport: vi.fn(async () => undefined),
          onEditCredentials: vi.fn(),
        }),
      );
    });

    const favicon = container.querySelector<HTMLImageElement>(
      'img[data-testid="platform-favicon"]',
    );
    expect(favicon).not.toBeNull();

    flushSync(() => {
      favicon?.dispatchEvent(new Event("error", { bubbles: true }));
    });
    await settleUi();

    expect(container.querySelector('img[data-testid="platform-favicon"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="platform-initials"]')?.textContent,
    ).toBe("MI");
  });
});

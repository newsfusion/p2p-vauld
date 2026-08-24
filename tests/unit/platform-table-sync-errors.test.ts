import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformCatalog } from "../../src/shared/platforms/index.js";
import { PlatformTable } from "../../src/dashboard/components/PlatformTable.js";

describe("PlatformTable sync failure messages", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it("shows login failure reason and Safe Mode retry hint", () => {
    const platform = getPlatformCatalog().find((entry) => entry.id === "mintos");
    if (!platform) throw new Error("Mintos platform is missing");

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [],
          syncStates: { [platform.id]: "failed_login" },
          syncSteps: {},
          syncErrors: {
            [platform.id]: "Login form fields not found",
          },
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

    expect(container.textContent).toContain("Login failed");
    expect(container.textContent).toContain(
      "Couldn't find the login form on the page.",
    );
    expect(container.textContent).toContain("Safe Mode was turned on automatically");
    expect(container.textContent).toContain("Update");
  });

  it("adds a failure tooltip to the live sync step for stale rows", () => {
    const platform = getPlatformCatalog().find((entry) => entry.id === "mintos");
    if (!platform) throw new Error("Mintos platform is missing");

    flushSync(() => {
      root.render(
        React.createElement(PlatformTable, {
          platforms: [platform],
          metrics: [
            {
              platformId: platform.id,
              fetchedAt: "2026-06-08T10:00:00.000Z",
              platformValue: 1000,
              freeCash: 25,
              currency: "EUR",
              confidence: 0.9,
            },
          ],
          syncStates: { [platform.id]: "failed_login" },
          syncSteps: {},
          syncErrors: {
            [platform.id]: "Invalid credentials on platform page",
          },
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

    const syncCell = container.querySelector("td[title*='Invalid credentials on platform page']");
    expect(syncCell).not.toBeNull();
    expect(syncCell?.textContent).toContain("Failed");
  });
});

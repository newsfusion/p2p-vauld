import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendBackgroundMock } = vi.hoisted(() => ({
  sendBackgroundMock: vi.fn(),
}));

vi.mock("../../src/shared/messages.js", () => ({
  sendBackground: sendBackgroundMock,
}));

import { ExportPanel } from "../../src/dashboard/components/ExportPanel.js";

const backup = {
  format: "p2p-portfolio-tracker-financial-backup" as const,
  version: 1 as const,
  exportedAt: "2026-06-08T10:00:00.000Z",
  appVersion: "0.12.75",
  payload: {
    overviewMetrics: [],
    metricsHistory: [],
    cashflows: [],
    positions: [],
    riskEvents: [],
    deltaLogs: [],
  },
};

async function settleUi(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ExportPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalCreateObjectUrl: typeof URL.createObjectURL | undefined;
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    originalCreateObjectUrl = URL.createObjectURL;
    originalRevokeObjectUrl = URL.revokeObjectURL;
    sendBackgroundMock.mockReset();
    sendBackgroundMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_EXPORT_DATA") return { data: backup.payload };
      if (message.type === "CREATE_FINANCIAL_BACKUP") return { backup };
      if (message.type === "VALIDATE_FINANCIAL_BACKUP") {
        return { valid: true, backup };
      }
      if (message.type === "RESTORE_FINANCIAL_BACKUP") {
        return { success: true, metrics: [], dataPlatformIds: [] };
      }
      return {};
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:export"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectUrl,
      });
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
    vi.restoreAllMocks();
  });

  it("requests export data for CSV and backup data for JSON downloads", async () => {
    flushSync(() => {
      root.render(
        React.createElement(ExportPanel, {
          onRestoreComplete: vi.fn(),
          visiblePlatformIds: [],
        }),
      );
    });

    container.querySelector<HTMLButtonElement>('[data-testid="export-csv"]')?.click();
    await settleUi();
    container.querySelector<HTMLButtonElement>('[data-testid="export-json"]')?.click();
    await settleUi();

    expect(sendBackgroundMock).toHaveBeenCalledWith({
      type: "GET_EXPORT_DATA",
    });
    expect(sendBackgroundMock).toHaveBeenCalledWith({
      type: "CREATE_FINANCIAL_BACKUP",
    });
  });

  it("omits disabled platforms from the CSV export but keeps them in the JSON backup", async () => {
    const overviewMetrics = [
      {
        platformId: "mintos",
        fetchedAt: "2026-06-08T10:00:00.000Z",
        platformValue: 1000,
        freeCash: 10,
        currency: "EUR",
        confidence: 0.9,
      },
      {
        platformId: "debitum",
        fetchedAt: "2026-06-08T10:00:00.000Z",
        platformValue: 2000,
        freeCash: 20,
        currency: "EUR",
        confidence: 0.9,
      },
    ];
    sendBackgroundMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_EXPORT_DATA") {
        return { data: { ...backup.payload, overviewMetrics } };
      }
      if (message.type === "CREATE_FINANCIAL_BACKUP") {
        return { backup: { ...backup, payload: { ...backup.payload, overviewMetrics } } };
      }
      return {};
    });

    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:export";
      }),
    });

    flushSync(() => {
      root.render(
        React.createElement(ExportPanel, {
          onRestoreComplete: vi.fn(),
          visiblePlatformIds: ["debitum"],
        }),
      );
    });

    container.querySelector<HTMLButtonElement>('[data-testid="export-csv"]')?.click();
    await settleUi();
    container.querySelector<HTMLButtonElement>('[data-testid="export-json"]')?.click();
    await settleUi();

    expect(blobs).toHaveLength(2);
    const csv = await blobs[0]!.text();
    expect(csv).toContain("debitum");
    expect(csv).not.toContain("mintos");

    const json = await blobs[1]!.text();
    expect(json).toContain("mintos");
  });

  it("validates selected restore files and requires confirmation before restore", async () => {
    flushSync(() => {
      root.render(
        React.createElement(ExportPanel, {
          onRestoreComplete: vi.fn(),
          visiblePlatformIds: [],
        }),
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="restore-file-input"]',
    );
    if (!input) throw new Error("restore file input missing");
    const file = new File([JSON.stringify(backup)], "backup.json", {
      type: "application/json",
    });
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settleUi();

    expect(sendBackgroundMock).toHaveBeenCalledWith({
      type: "VALIDATE_FINANCIAL_BACKUP",
      payload: { backup },
    });

    container
      .querySelector<HTMLButtonElement>('[data-testid="restore-backup"]')
      ?.click();
    await settleUi();

    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("restore confirmation dialog missing");
    expect(sendBackgroundMock).not.toHaveBeenCalledWith({
      type: "RESTORE_FINANCIAL_BACKUP",
      payload: { backup },
    });

    const cancelButton = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Cancel",
    );
    cancelButton?.click();
    await settleUi();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(sendBackgroundMock).not.toHaveBeenCalledWith({
      type: "RESTORE_FINANCIAL_BACKUP",
      payload: { backup },
    });
  });

  it("closes the confirmation dialog on Escape and returns focus to the trigger", async () => {
    flushSync(() => {
      root.render(
        React.createElement(ExportPanel, {
          onRestoreComplete: vi.fn(),
          visiblePlatformIds: [],
        }),
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="restore-file-input"]',
    );
    if (!input) throw new Error("restore file input missing");
    const file = new File([JSON.stringify(backup)], "backup.json", {
      type: "application/json",
    });
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settleUi();

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="restore-backup"]',
    );
    trigger?.focus();
    trigger?.click();
    await settleUi();

    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("restore confirmation dialog missing");
    expect(document.activeElement?.textContent?.trim()).toBe("Cancel");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await settleUi();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(sendBackgroundMock).not.toHaveBeenCalledWith({
      type: "RESTORE_FINANCIAL_BACKUP",
      payload: { backup },
    });
  });

  it("restores the backup once the confirmation dialog is accepted", async () => {
    const onRestoreComplete = vi.fn();
    flushSync(() => {
      root.render(
        React.createElement(ExportPanel, {
          onRestoreComplete,
          visiblePlatformIds: [],
        }),
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="restore-file-input"]',
    );
    if (!input) throw new Error("restore file input missing");
    const file = new File([JSON.stringify(backup)], "backup.json", {
      type: "application/json",
    });
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settleUi();

    container
      .querySelector<HTMLButtonElement>('[data-testid="restore-backup"]')
      ?.click();
    await settleUi();

    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("restore confirmation dialog missing");
    const confirmButton = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Restore",
    );
    confirmButton?.click();
    await settleUi();

    expect(sendBackgroundMock).toHaveBeenCalledWith({
      type: "RESTORE_FINANCIAL_BACKUP",
      payload: { backup },
    });
    expect(onRestoreComplete).toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

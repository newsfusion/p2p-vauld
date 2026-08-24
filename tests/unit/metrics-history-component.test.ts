import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StoredIngestionBatch,
  StoredMetricsSnapshot,
} from "../../src/shared/types/index.js";

const sendBackground = vi.fn();

const eur = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
  }).format(value);

vi.mock("../../src/shared/messages.js", () => ({
  sendBackground,
}));

async function settleUi(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

async function waitForAssertion(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      assertion();
      return;
    } catch {
      await settleUi();
    }
  }
  assertion();
}

function createSnapshot(
  overrides: Partial<StoredMetricsSnapshot> = {},
): StoredMetricsSnapshot {
  return {
    platformId: "mintos",
    date: "2026-05-21",
    platformValue: 10250,
    freeCash: 525,
    fetchedAt: "2026-05-21T12:00:00.000Z",
    currency: "EUR",
    confidence: 0.95,
    batchId: 77,
    ...overrides,
  };
}

function createBatch(overrides: Partial<StoredIngestionBatch> = {}): StoredIngestionBatch {
  return {
    id: 77,
    platformId: "mintos",
    sourceKind: "sync",
    runId: "run-77",
    appliedAt: "2026-05-21T12:00:00.000Z",
    revertible: true,
    legacyBackfilled: false,
    afterDailySnapshot: createSnapshot(),
    cashflowCount: 0,
    positionCount: 0,
    riskEventCount: 0,
    ...overrides,
  };
}

function mockHistoryResponses(options: {
  snapshots: StoredMetricsSnapshot[];
  batches?: StoredIngestionBatch[];
}): void {
  sendBackground.mockImplementation(async (message: { type: string }) => {
    if (message.type === "GET_METRICS_HISTORY") {
      return { snapshots: options.snapshots };
    }
    if (message.type === "GET_PLATFORM_BATCH_HISTORY") {
      return { batches: options.batches ?? [] };
    }
    return { success: true };
  });
}

describe("MetricsHistory", () => {
  let container: HTMLDivElement;
  let root: Root;
  let MetricsHistory: typeof import("../../src/dashboard/components/MetricsHistory.js").MetricsHistory;

  beforeAll(async () => {
    ({ MetricsHistory } = await import(
      "../../src/dashboard/components/MetricsHistory.js"
    ));
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    sendBackground.mockReset();
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  function renderHistory(
    props: Partial<React.ComponentProps<typeof MetricsHistory>> = {},
  ): void {
    flushSync(() => {
      root.render(
        React.createElement(
          "table",
          null,
          React.createElement(
            "tbody",
            null,
            React.createElement(MetricsHistory, {
              platformId: "mintos",
              platformName: "Mintos",
              privacyMode: false,
              syncState: "success",
              isSyncable: true,
              ...props,
            }),
          ),
        ),
      );
    });
  }

  function findButtonByText(label: string): HTMLButtonElement | undefined {
    return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === label,
    );
  }

  it("renders snapshot rows with values and edit/delete actions", async () => {
    mockHistoryResponses({
      snapshots: [
        createSnapshot(),
        createSnapshot({
          date: "2026-05-20",
          platformValue: 10000,
          freeCash: 500,
          fetchedAt: "2026-05-20T12:00:00.000Z",
          batchId: 76,
        }),
      ],
    });

    renderHistory();

    await waitForAssertion(() => {
      expect(sendBackground).toHaveBeenCalledWith({
        type: "GET_METRICS_HISTORY",
        payload: { platformId: "mintos" },
      });
      expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    });

    const firstRowCells = container.querySelectorAll("tbody tr")[0]?.querySelectorAll("td");
    expect(firstRowCells?.[2]?.textContent).toContain(eur(10250));
    expect(firstRowCells?.[3]?.textContent).toContain(eur(525));
    expect(container.querySelector('[data-testid="history-edit-2026-05-21"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="history-delete-2026-05-21"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="history-edit-2026-05-20"]')).not.toBeNull();
  });

  it("renders signed deltas with trend arrows when a snapshot has batch context", async () => {
    mockHistoryResponses({
      snapshots: [createSnapshot()],
      batches: [
        createBatch({
          beforeOverview: {
            platformId: "mintos",
            platformValue: 10000,
            freeCash: 500,
            fetchedAt: "2026-05-20T12:00:00.000Z",
          },
          afterOverview: {
            platformId: "mintos",
            platformValue: 10250,
            freeCash: 525,
            fetchedAt: "2026-05-21T12:00:00.000Z",
          },
        }),
      ],
    });

    renderHistory();

    await waitForAssertion(() => {
      const firstRowCells = container
        .querySelectorAll("tbody tr")[0]
        ?.querySelectorAll("td");
      expect(firstRowCells?.[2]?.textContent).toContain(`+${eur(250)}`);
      expect(firstRowCells?.[2]?.textContent).toContain(eur(10250));
      expect(firstRowCells?.[2]?.querySelector(".text-success svg")).not.toBeNull();
      expect(firstRowCells?.[3]?.textContent).toContain(`+${eur(25)}`);
      expect(firstRowCells?.[3]?.textContent).toContain(eur(525));
      expect(firstRowCells?.[3]?.querySelector(".text-success svg")).not.toBeNull();
    });
  });

  it("computes deltas from the current snapshot value after an edit", async () => {
    mockHistoryResponses({
      snapshots: [
        createSnapshot({
          platformValue: 10100,
          freeCash: 540,
        }),
      ],
      batches: [
        createBatch({
          beforeOverview: {
            platformId: "mintos",
            platformValue: 10000,
            freeCash: 500,
            fetchedAt: "2026-05-20T12:00:00.000Z",
          },
          afterOverview: {
            platformId: "mintos",
            platformValue: 10250,
            freeCash: 525,
            fetchedAt: "2026-05-21T12:00:00.000Z",
          },
        }),
      ],
    });

    renderHistory();

    await waitForAssertion(() => {
      const firstRowCells = container
        .querySelectorAll("tbody tr")[0]
        ?.querySelectorAll("td");
      expect(firstRowCells?.[2]?.textContent).toContain(`+${eur(100)}`);
      expect(firstRowCells?.[2]?.textContent).not.toContain(`+${eur(250)}`);
      expect(firstRowCells?.[2]?.textContent).toContain(eur(10100));
      expect(firstRowCells?.[3]?.textContent).toContain(`+${eur(40)}`);
      expect(firstRowCells?.[3]?.textContent).not.toContain(`+${eur(25)}`);
      expect(firstRowCells?.[3]?.textContent).toContain(eur(540));
    });
  });

  it("saves an edited entry and reloads the history", async () => {
    mockHistoryResponses({ snapshots: [createSnapshot()] });

    renderHistory();
    await settleUi();

    container
      .querySelector<HTMLButtonElement>('[data-testid="history-edit-2026-05-21"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(
        container.querySelector('[data-testid="history-input-value-2026-05-21"]'),
      ).not.toBeNull();
    });

    const valueInput = container.querySelector<HTMLInputElement>(
      '[data-testid="history-input-value-2026-05-21"]',
    )!;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    nativeSetter.call(valueInput, "9999.5");
    valueInput.dispatchEvent(new Event("input", { bubbles: true }));

    await settleUi();

    container
      .querySelector<HTMLButtonElement>('[data-testid="history-save-2026-05-21"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(sendBackground).toHaveBeenCalledWith({
        type: "UPDATE_METRICS_SNAPSHOT",
        payload: {
          platformId: "mintos",
          date: "2026-05-21",
          platformValue: 9999.5,
          freeCash: 525,
        },
      });
    });
  });

  it("deletes an entry after confirmation and reloads", async () => {
    let deleted = false;
    sendBackground.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_METRICS_HISTORY") {
        return { snapshots: deleted ? [] : [createSnapshot()] };
      }
      if (message.type === "GET_PLATFORM_BATCH_HISTORY") {
        return { batches: [] };
      }
      if (message.type === "DELETE_METRICS_SNAPSHOT") {
        deleted = true;
        return { success: true };
      }
      return { success: true };
    });

    renderHistory();
    await settleUi();

    container
      .querySelector<HTMLButtonElement>('[data-testid="history-delete-2026-05-21"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
        "Delete this history entry?",
      );
    });
    findButtonByText("Delete")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(sendBackground).toHaveBeenCalledWith({
        type: "DELETE_METRICS_SNAPSHOT",
        payload: { platformId: "mintos", date: "2026-05-21" },
      });
      expect(container.textContent).toContain("No history recorded yet.");
    });
  });

  it("does not delete when the user cancels the confirmation", async () => {
    mockHistoryResponses({ snapshots: [createSnapshot()] });

    renderHistory();
    await settleUi();

    container
      .querySelector<HTMLButtonElement>('[data-testid="history-delete-2026-05-21"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
        "Delete this history entry?",
      );
    });
    findButtonByText("Cancel")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(
      sendBackground.mock.calls.filter(
        (call) => call[0]?.type === "DELETE_METRICS_SNAPSHOT",
      ),
    ).toHaveLength(0);
  });

  it("does not reopen the delete confirmation after a failed delete is followed by reload", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_METRICS_HISTORY") {
        return { snapshots: [createSnapshot()] };
      }
      if (message.type === "GET_PLATFORM_BATCH_HISTORY") {
        return { batches: [] };
      }
      if (message.type === "DELETE_METRICS_SNAPSHOT") {
        return { success: false, error: "Delete failed" };
      }
      return { success: true };
    });

    renderHistory();
    await settleUi();

    container
      .querySelector<HTMLButtonElement>('[data-testid="history-delete-2026-05-21"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
        "Delete this history entry?",
      );
    });
    findButtonByText("Delete")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Delete failed");
    });

    renderHistory({ syncState: "running" });
    renderHistory({ syncState: "success" });
    await settleUi();

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("exposes undo on the row matching the latest revertible batch", async () => {
    mockHistoryResponses({
      snapshots: [
        createSnapshot(),
        createSnapshot({
          date: "2026-05-20",
          platformValue: 10000,
          freeCash: 500,
          fetchedAt: "2026-05-20T12:00:00.000Z",
          batchId: 76,
        }),
      ],
      batches: [createBatch({ id: 77 })],
    });

    renderHistory();

    await waitForAssertion(() => {
      expect(container.querySelector('[data-testid="batch-undo-77"]')).not.toBeNull();
    });
    expect(container.querySelectorAll('[data-testid^="batch-undo-"]')).toHaveLength(1);

    container
      .querySelector<HTMLButtonElement>('[data-testid="batch-undo-77"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
        "Revert this platform to the state before this import?",
      );
    });
    findButtonByText("Revert")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(sendBackground).toHaveBeenCalledWith({
        type: "REVERT_PLATFORM_BATCH",
        payload: { platformId: "mintos", batchId: 77 },
      });
    });
  });

  it("does not reopen the revert confirmation after a failed revert is followed by reload", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_METRICS_HISTORY") {
        return { snapshots: [createSnapshot()] };
      }
      if (message.type === "GET_PLATFORM_BATCH_HISTORY") {
        return { batches: [createBatch({ id: 77 })] };
      }
      if (message.type === "REVERT_PLATFORM_BATCH") {
        return { success: false, error: "Revert failed" };
      }
      return { success: true };
    });

    renderHistory();

    await waitForAssertion(() => {
      expect(container.querySelector('[data-testid="batch-undo-77"]')).not.toBeNull();
    });

    container
      .querySelector<HTMLButtonElement>('[data-testid="batch-undo-77"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain(
        "Revert this platform to the state before this import?",
      );
    });
    findButtonByText("Revert")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(container.textContent).toContain("Revert failed");
    });

    renderHistory({ syncState: "running" });
    renderHistory({ syncState: "success" });
    await settleUi();

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows report icons only on the latest revertible import row and opens the explanation modal", async () => {
    const reportWrongImport = vi.fn(async () => undefined);
    mockHistoryResponses({
      snapshots: [
        createSnapshot(),
        createSnapshot({
          date: "2026-05-20",
          platformValue: 10000,
          freeCash: 500,
          fetchedAt: "2026-05-20T12:00:00.000Z",
          batchId: 76,
        }),
      ],
      batches: [createBatch({ id: 77 })],
    });

    renderHistory({ onReportWrongImport: reportWrongImport });

    await waitForAssertion(() => {
      expect(
        container.querySelector('[data-testid="history-report-value-2026-05-21"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-testid="history-report-cash-2026-05-21"]'),
      ).not.toBeNull();
    });
    expect(
      container.querySelector('[data-testid="history-report-value-2026-05-20"]'),
    ).toBeNull();

    container
      .querySelector<HTMLButtonElement>(
        '[data-testid="history-report-value-2026-05-21"]',
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(document.body.textContent).toContain("Report wrong imported value");
      expect(document.body.textContent).toContain(
        "Was the last import for Mintos wrong?",
      );
      expect(document.body.textContent).toContain(
        "choose the correct Portfolio Value and Free Cash from all detected values",
      );
    });

    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Keep import")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(document.body.textContent).not.toContain(
        "Report wrong imported value",
      );
    });
    expect(reportWrongImport).not.toHaveBeenCalled();
  });

  it("confirms a wrong-value report through the callback and reloads history", async () => {
    const reportWrongImport = vi.fn(async () => undefined);
    mockHistoryResponses({
      snapshots: [createSnapshot()],
      batches: [createBatch({ id: 77 })],
    });

    renderHistory({ onReportWrongImport: reportWrongImport });

    await waitForAssertion(() => {
      expect(
        container.querySelector('[data-testid="history-report-cash-2026-05-21"]'),
      ).not.toBeNull();
    });

    container
      .querySelector<HTMLButtonElement>(
        '[data-testid="history-report-cash-2026-05-21"]',
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(document.body.textContent).toContain("Report wrong imported value");
    });

    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Yes, undo and resync")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAssertion(() => {
      expect(reportWrongImport).toHaveBeenCalledWith({
        platformId: "mintos",
        batchId: 77,
      });
      expect(
        sendBackground.mock.calls.filter(
          (call) => call[0]?.type === "GET_METRICS_HISTORY",
        ),
      ).toHaveLength(2);
    });
  });

  it("disables report actions for imported-only platforms", async () => {
    mockHistoryResponses({
      snapshots: [createSnapshot()],
      batches: [createBatch({ id: 77 })],
    });

    renderHistory({
      isSyncable: false,
      onReportWrongImport: vi.fn(async () => undefined),
    });

    await waitForAssertion(() => {
      expect(
        container.querySelector<HTMLButtonElement>(
          '[data-testid="history-report-value-2026-05-21"]',
        )?.disabled,
      ).toBe(true);
      expect(
        container.querySelector<HTMLButtonElement>(
          '[data-testid="history-report-cash-2026-05-21"]',
        )?.disabled,
      ).toBe(true);
    });
  });

  it("hides undo when the latest batch is not revertible", async () => {
    mockHistoryResponses({
      snapshots: [createSnapshot()],
      batches: [createBatch({ id: 77, revertible: false })],
    });

    renderHistory();
    await settleUi();

    expect(container.querySelectorAll('[data-testid^="batch-undo-"]')).toHaveLength(0);
  });

  it("disables actions while the same platform is syncing", async () => {
    mockHistoryResponses({
      snapshots: [createSnapshot()],
      batches: [createBatch({ id: 77 })],
    });

    renderHistory({ syncState: "running" });
    await settleUi();

    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="history-edit-2026-05-21"]',
      )?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="history-delete-2026-05-21"]',
      )?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="batch-undo-77"]')
        ?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="history-report-value-2026-05-21"]',
      )?.disabled,
    ).toBe(true);
  });

  it("reloads history when the platform sync finishes", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_METRICS_HISTORY") {
        const loadCount = sendBackground.mock.calls.filter(
          (call) => call[0]?.type === "GET_METRICS_HISTORY",
        ).length;
        return {
          snapshots: [
            createSnapshot(
              loadCount === 1
                ? {}
                : {
                    date: "2026-05-22",
                    fetchedAt: "2026-05-22T12:00:00.000Z",
                  },
            ),
          ],
        };
      }
      if (message.type === "GET_PLATFORM_BATCH_HISTORY") {
        return { batches: [] };
      }
      return { success: true };
    });

    renderHistory({ syncState: "running" });
    await settleUi();

    expect(container.querySelector('[data-testid="history-edit-2026-05-21"]')).not.toBeNull();

    renderHistory({ syncState: "success" });
    await waitForAssertion(() => {
      expect(
        container.querySelector('[data-testid="history-edit-2026-05-22"]'),
      ).not.toBeNull();
    });
    expect(
      sendBackground.mock.calls.filter(
        (call) => call[0]?.type === "GET_METRICS_HISTORY",
      ),
    ).toHaveLength(2);
  });
});

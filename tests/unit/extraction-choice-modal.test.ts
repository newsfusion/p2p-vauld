import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtractionChoiceModal } from "../../src/dashboard/components/ExtractionChoiceModal.js";
import type { ExtractionChoiceRequest } from "../../src/shared/types/index.js";

const request: ExtractionChoiceRequest = {
  requestId: "choice-1",
  runId: "run-1",
  platformId: "mintos",
  platformName: "Mintos",
  signalKey: "portfolio_value",
  expiresAt: "2026-06-09T08:00:00.000Z",
  candidates: [
    {
      candidateId: "candidate-1",
      selector: ".balance",
      text: "€ 1,000.00",
      value: 1000,
      score: 4.3,
      context: "Account Balance",
      valueType: "currency",
    },
  ],
};

describe("ExtractionChoiceModal", () => {
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

  function renderModal(
    props: Partial<React.ComponentProps<typeof ExtractionChoiceModal>> = {},
  ) {
    const onChoose = vi.fn();
    const onCancel = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(ExtractionChoiceModal, {
          request,
          onChoose,
          onCancel,
          ...props,
        }),
      );
    });

    return { onChoose, onCancel };
  }

  it("calls onCancel from the footer and close button", () => {
    const { onChoose, onCancel } = renderModal();

    const cancelButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.includes("Cancel Sync"),
    );
    expect(cancelButtons).toHaveLength(1);

    cancelButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    const closeButton = container.querySelector('button[aria-label="Cancel sync"]');
    closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("sorts candidates by confidence, displays percent, and chooses the sorted candidate id", () => {
    const choiceRequest: ExtractionChoiceRequest = {
      ...request,
      candidates: [
        {
          candidateId: "low-confidence",
          selector: ".sidebar-total",
          text: "€ 750.00",
          value: 750,
          score: 2,
          context: "Sidebar Total",
          valueType: "currency",
        },
        {
          candidateId: "highest-confidence",
          selector: ".portfolio",
          text: "€ 1,000.00",
          value: 1000,
          score: 5,
          context: "Portfolio Value",
          valueType: "currency",
          geminiSupported: true,
        },
        {
          candidateId: "middle-confidence",
          selector: ".invested",
          text: "€ 900.00",
          value: 900,
          score: 3,
          context: "Invested Amount",
          valueType: "currency",
        },
      ],
    };

    const { onChoose } = renderModal({ request: choiceRequest });

    const rowTitles = Array.from(
      container.querySelectorAll<HTMLElement>("div[title]"),
    ).map((row) => row.title);
    expect(rowTitles).toHaveLength(3);
    expect(rowTitles[0]).toContain(".portfolio");
    expect(rowTitles[1]).toContain(".invested");
    expect(rowTitles[2]).toContain(".sidebar-total");
    expect(container.textContent).toContain("94%");

    const useButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.includes("Use this value"),
    );
    useButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onChoose).toHaveBeenCalledWith("highest-confidence");
  });

  it("renders only one option per equal numeric value", () => {
    const choiceRequest: ExtractionChoiceRequest = {
      ...request,
      candidates: [
        {
          candidateId: "debitum-a",
          selector: ".balance-a",
          text: "My balance €66.36",
          value: 66.36,
          score: 4.3,
          context: "My balance €66.36",
          valueType: "currency",
          geminiSupported: true,
        },
        {
          candidateId: "debitum-b",
          selector: ".balance-b",
          text: "My balance €66.36",
          value: 66.36,
          score: 4.3,
          context: "My balance €66.36",
          valueType: "currency",
          geminiSupported: true,
        },
      ],
    };

    const { onChoose } = renderModal({ request: choiceRequest });

    const useButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.includes("Use this value"),
    );
    expect(useButtons).toHaveLength(1);
    const rows = Array.from(container.querySelectorAll<HTMLElement>("div[title]"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain(".balance-a");
    expect(container.innerHTML).not.toContain(".balance-b");

    useButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onChoose).toHaveBeenCalledWith("debitum-a");
  });
});

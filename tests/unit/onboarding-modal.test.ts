import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendBackgroundMock = vi.fn();

vi.mock("../../src/shared/messages.js", () => ({
  sendBackground: sendBackgroundMock,
}));

describe("OnboardingModal", () => {
  let container: HTMLDivElement;
  let root: Root;
  let OnboardingModal: typeof import("../../src/dashboard/components/OnboardingModal.js").OnboardingModal;
  const onComplete = vi.fn();

  beforeAll(async () => {
    ({ OnboardingModal } = await import("../../src/dashboard/components/OnboardingModal.js"));
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onComplete.mockReset();
    sendBackgroundMock.mockReset();
    sendBackgroundMock.mockResolvedValue({ success: true });
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  function renderModal(): void {
    flushSync(() => {
      root.render(React.createElement(OnboardingModal, { onComplete }));
    });
  }

  async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function click(element: Element | null | undefined): void {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function inputValue(input: HTMLInputElement, value: string): void {
    const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("does not mark invisible key as recommended and shows local profile risk", async () => {
    renderModal();

    expect(container.querySelector('img[src="/vauld-banner.png"]')).not.toBeNull();
    expect(container.textContent).toContain("Welcome to P2P Portfolio Tracker");
    expect(container.textContent).not.toContain("Welcome to P2P Vauld");
    expect(container.textContent).toContain("Use Invisible Key");
    expect(container.textContent).not.toContain("Recommended");

    click(Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Use Invisible Key"),
    ));
    await flushAsyncWork();

    expect(container.textContent).toContain("browser profile");
    expect(container.textContent).toContain("decrypt saved platform credentials");
  });

  it("requires explicit confirmation before initializing invisible key", async () => {
    renderModal();

    const invisibleKeyButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Use Invisible Key"),
    );
    click(invisibleKeyButton);
    await flushAsyncWork();

    expect(sendBackgroundMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "INIT_INVISIBLE_KEY" }),
    );

    const confirmButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Continue"),
    );
    click(confirmButton);
    await flushAsyncWork();

    expect(sendBackgroundMock).toHaveBeenCalledWith({ type: "INIT_INVISIBLE_KEY" });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("shows advisory strength and accepts a matching one-character password", async () => {
    renderModal();
    click(Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Set a Master Password"),
    ));
    await flushAsyncWork();

    const inputs = container.querySelectorAll<HTMLInputElement>(
      'input[autocomplete="new-password"]',
    );
    inputValue(inputs[0]!, "x");
    inputValue(inputs[1]!, "x");
    await flushAsyncWork();

    expect(container.textContent).toContain("Very weak");
    container.querySelector("form")?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await flushAsyncWork();

    expect(sendBackgroundMock).toHaveBeenCalledWith({
      type: "SETUP_MASTER_PASSWORD",
      payload: { password: "x" },
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

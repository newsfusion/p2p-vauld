import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendBackgroundMock = vi.fn();

vi.mock("../../src/shared/messages.js", () => ({
  sendBackground: sendBackgroundMock,
}));

async function settleUi(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

function inputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("UnlockForm", () => {
  let container: HTMLDivElement;
  let root: Root;
  let UnlockForm: typeof import("../../src/shared/components/UnlockForm.js").UnlockForm;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    sendBackgroundMock.mockResolvedValue({ success: true });
    ({ UnlockForm } = await import("../../src/shared/components/UnlockForm.js"));
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.clearAllMocks();
  });

  it("submits the master password and reports success", async () => {
    const onUnlocked = vi.fn();
    flushSync(() => {
      root.render(React.createElement(UnlockForm, { onUnlocked }));
    });

    const input = container.querySelector<HTMLInputElement>("input");
    inputValue(input!, "secret");
    await settleUi();
    container
      .querySelector<HTMLButtonElement>('button[type="submit"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleUi();

    expect(sendBackgroundMock).toHaveBeenCalledWith({
      type: "UNLOCK",
      payload: { password: "secret" },
    });
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(input!.value).toBe("");
  });

  it("shows unlock errors and keeps the form usable", async () => {
    sendBackgroundMock.mockResolvedValue({ success: false, error: "Incorrect password" });
    flushSync(() => {
      root.render(React.createElement(UnlockForm, { onUnlocked: () => undefined }));
    });

    const input = container.querySelector<HTMLInputElement>("input");
    inputValue(input!, "wrong");
    await settleUi();
    container
      .querySelector<HTMLButtonElement>('button[type="submit"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleUi();

    expect(container.textContent).toContain("Incorrect password");
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it("disables empty submits and toggles password visibility", async () => {
    flushSync(() => {
      root.render(React.createElement(UnlockForm, { onUnlocked: () => undefined }));
    });

    const input = container.querySelector<HTMLInputElement>("input")!;
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Show password"]')!;

    expect(submit.disabled).toBe(true);
    expect(input.type).toBe("password");

    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleUi();

    expect(input.type).toBe("text");
    expect(container.querySelector('button[aria-label="Hide password"]')).not.toBeNull();
  });

  it("uses the placeholder as the password input accessible name when no label is rendered", () => {
    flushSync(() => {
      root.render(
        React.createElement(UnlockForm, {
          onUnlocked: () => undefined,
          placeholder: "Master password",
        }),
      );
    });

    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Master password"]'),
    ).not.toBeNull();
  });
});

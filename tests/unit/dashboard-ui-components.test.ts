import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("dashboard UI primitives", () => {
  let container: HTMLDivElement;
  let root: Root;
  let ui: typeof import("../../src/dashboard/components/ui/index.js");

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    ui = await import("../../src/dashboard/components/ui/index.js");
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.clearAllMocks();
  });

  it("renders SwitchToggle with preserved switch semantics", () => {
    const onChange = vi.fn();
    flushSync(() => {
      root.render(
        React.createElement(ui.SwitchToggle, {
          label: "Debug Mode",
          description: "Show details",
          checked: true,
          onChange,
          testId: "debug-toggle",
        }),
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="debug-toggle"]',
    );
    expect(button?.getAttribute("role")).toBe("switch");
    expect(button?.getAttribute("aria-label")).toBe("Debug Mode");
    expect(button?.getAttribute("aria-checked")).toBe("true");
    expect(button?.className).toContain("h-6 w-11");
    expect(container.textContent).toContain("Show details");

    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("renders ModalShell with dialog aria wiring and provided panel classes", () => {
    flushSync(() => {
      root.render(
        React.createElement(
          ui.ModalShell,
          {
            titleId: "modal-title",
            descriptionId: "modal-description",
            panelClassName: "w-full max-w-md rounded-lg border",
          },
          React.createElement("h2", { id: "modal-title" }, "Title"),
          React.createElement("p", { id: "modal-description" }, "Description"),
        ),
      );
    });

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.className).toBe("modal-overlay");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("modal-title");
    expect(dialog?.getAttribute("aria-describedby")).toBe("modal-description");
    expect(dialog?.querySelector("div")?.className).toContain("modal-pop");
    expect(dialog?.querySelector("div")?.className).toContain("max-w-md");
  });

  it("renders StatusBadge and FormField without inventing extra behavior", () => {
    flushSync(() => {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ui.StatusBadge, { variant: "success" }, "Active"),
          React.createElement(ui.FormField, {
            id: "email",
            label: "Email",
            value: "test@example.com",
            onChange: () => undefined,
            className: "custom-input",
          }),
        ),
      );
    });

    const badge = container.querySelector("span");
    expect(badge?.className).toContain("inline-flex");
    expect(badge?.className).toContain("bg-success/10 text-success");
    expect(container.querySelector('label[for="email"]')?.textContent).toBe(
      "Email",
    );
    expect(container.querySelector("input")?.className).toContain("custom-input");
  });
});

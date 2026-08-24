import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncProgressDetail } from "../../src/dashboard/components/SyncProgressDetail.js";
import type { PlatformDescriptor, PlatformId } from "../../src/shared/types/index.js";

const platforms: PlatformDescriptor[] = [
  {
    id: "mintos",
    name: "Mintos",
    enabled: true,
    strategy: "universal",
  },
  {
    id: "peerberry",
    name: "PeerBerry",
    enabled: true,
    strategy: "universal",
  },
  {
    id: "debitum",
    name: "Debitum",
    enabled: true,
    strategy: "universal",
  },
];

describe("SyncProgressDetail", () => {
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

  it("renders platform sync states as numbered cards with queue labels", () => {
    const onCancelPlatform = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(SyncProgressDetail, {
          platforms,
          syncStates: {
            mintos: "running",
            peerberry: "pending",
            debitum: "pending",
          },
          queuedPlatformIds: ["peerberry", "debitum"],
          onCancelPlatform,
        }),
      );
    });

    const cards = platforms.map((platform) =>
      container.querySelector(`[data-testid="sync-progress-card-${platform.id}"]`),
    );

    expect(container.querySelectorAll('[data-testid^="sync-progress-card-"]')).toHaveLength(3);
    expect(cards).toHaveLength(3);
    expect(cards.every(Boolean)).toBe(true);
    expect(cards[0]?.firstElementChild?.textContent).toBe("1");
    expect(cards[1]?.firstElementChild?.textContent).toBe("2");
    expect(cards[2]?.firstElementChild?.textContent).toBe("3");
    expect(cards[1]?.textContent).toContain("In Queue #1");
    expect(cards[2]?.textContent).toContain("In Queue #2");
    expect(container.querySelector('[title="Cancel Mintos"]')).not.toBeNull();
    expect(container.querySelector('[title="Cancel PeerBerry"]')).not.toBeNull();
    expect(container.querySelector('[title="Cancel Debitum"]')).not.toBeNull();
  });

  it("wires cancel buttons to the platform id", () => {
    const onCancelPlatform = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(SyncProgressDetail, {
          platforms,
          syncStates: {
            mintos: "success",
            peerberry: "pending",
            debitum: "running",
          },
          queuedPlatformIds: ["peerberry"],
          onCancelPlatform,
        }),
      );
    });

    container
      .querySelector<HTMLButtonElement>('[title="Cancel Debitum"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container
      .querySelector<HTMLButtonElement>('[title="Cancel PeerBerry"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(container.querySelector('[title="Cancel Mintos"]')).toBeNull();
    expect(onCancelPlatform).toHaveBeenNthCalledWith(1, "debitum" satisfies PlatformId);
    expect(onCancelPlatform).toHaveBeenNthCalledWith(2, "peerberry" satisfies PlatformId);
  });
});

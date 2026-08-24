import { beforeEach, describe, expect, it } from "vitest";
import { dismissKnownOverlays } from "../../src/content/overlay-handling.js";

describe("overlay handling", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("prefers rejecting vendor cookie consent before accepting", () => {
    document.body.innerHTML = `
      <div id="onetrust-banner-sdk">
        <button id="accept">Accept all</button>
        <button id="reject">Reject all</button>
      </div>
    `;
    let accepted = false;
    let rejected = false;
    document.getElementById("accept")?.addEventListener("click", () => {
      accepted = true;
    });
    document.getElementById("reject")?.addEventListener("click", () => {
      rejected = true;
    });

    const result = dismissKnownOverlays(document);

    expect(accepted).toBe(false);
    expect(rejected).toBe(true);
    expect(result.clicked).toEqual([
      {
        vendor: "onetrust",
        selector: "#onetrust-banner-sdk",
        text: "reject all",
        action: "reject",
      },
    ]);
  });

  it("uses accept as a fallback for known vendor banners", () => {
    document.body.innerHTML = `
      <div id="CybotCookiebotDialog">
        <button id="accept">Accept all</button>
      </div>
    `;
    let clicked = false;
    document.getElementById("accept")?.addEventListener("click", () => {
      clicked = true;
    });

    const result = dismissKnownOverlays(document);

    expect(clicked).toBe(true);
    expect(result.clicked).toHaveLength(1);
    expect(result.clicked[0]).toEqual({
      vendor: "cookiebot",
      selector: "#CybotCookiebotDialog",
      text: "accept all",
      action: "accept",
    });
  });

  it("does not click generic dialog buttons even when they look harmless", () => {
    document.body.innerHTML = `
      <div role="dialog">
        <button id="ok">OK</button>
      </div>
    `;
    let clicked = false;
    document.getElementById("ok")?.addEventListener("click", () => {
      clicked = true;
    });

    const result = dismissKnownOverlays(document);

    expect(clicked).toBe(false);
    expect(result.clicked).toHaveLength(0);
  });
});

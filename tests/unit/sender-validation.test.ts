import { beforeEach, describe, expect, it } from "vitest";
import {
  assertBackgroundMessageSender,
  isInternalSender,
} from "../../src/background/sender-validation.js";

function sender(
  overrides: Partial<chrome.runtime.MessageSender>,
): chrome.runtime.MessageSender {
  return overrides as chrome.runtime.MessageSender;
}

describe("background sender validation", () => {
  beforeEach(() => {
    Object.defineProperty(chrome.runtime, "id", {
      configurable: true,
      value: "abcdefghijklmnopabcdefghijklmnop",
    });
  });

  it("accepts extension pages as internal senders", () => {
    expect(
      isInternalSender(
        sender({
          id: chrome.runtime.id,
          url: `chrome-extension://${chrome.runtime.id}/dashboard.html`,
        }),
      ),
    ).toBe(true);
  });

  it("rejects content scripts for sensitive background messages", () => {
    const contentSender = sender({
      id: chrome.runtime.id,
      tab: { id: 3 } as chrome.tabs.Tab,
      url: "https://example.com/dashboard",
    });

    expect(() =>
      assertBackgroundMessageSender(contentSender, {
        type: "SAVE_SETTINGS",
        payload: { privacyModeEnabled: true },
      }),
    ).toThrow(/only allowed from the extension UI/);
  });

  it("allows content scripts to use only the AI proxy background messages", () => {
    const contentSender = sender({
      id: chrome.runtime.id,
      tab: { id: 3 } as chrome.tabs.Tab,
      url: "https://example.com/dashboard",
    });

    expect(() =>
      assertBackgroundMessageSender(contentSender, {
        type: "PROXY_CHECK_AI",
      }),
    ).not.toThrow();
    expect(() =>
      assertBackgroundMessageSender(contentSender, {
        type: "PROXY_AI_PROMPT",
        payload: {
          systemPrompt: "system",
          examples: [{ role: "user", content: "example" }],
          input: "input",
        },
      }),
    ).not.toThrow();
  });
});

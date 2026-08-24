import { describe, expect, it, vi } from "vitest";
import {
  createStepTimer,
  describeLoginElement,
} from "../../src/dashboard/utils/extractor-helpers.js";

describe("extractor helper utilities", () => {
  it("tracks lap and total elapsed time", () => {
    vi.useFakeTimers();
    try {
      const timer = createStepTimer();
      vi.advanceTimersByTime(25);
      expect(timer.lap()).toBe(25);
      vi.advanceTimersByTime(40);
      expect(timer.lap()).toBe(40);
      expect(timer.total()).toBe(65);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the login element description format unchanged", () => {
    const input = document.createElement("input");
    input.type = "email";
    input.name = "user";
    input.id = "login-email";
    input.placeholder = "Email";

    expect(describeLoginElement(input)).toBe(
      '<input type="email" name="user" id="login-email" placeholder="Email">',
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getManualActionProgressMessage,
  waitForManualAction,
  resolvePendingManualAction,
} from "../../src/background/sync/manual-action.js";
import type { ManualActionResolveResult } from "../../src/background/sync/manual-action.js";
import type { PlatformCatalogEntry } from "../../src/shared/types/index.js";

const sendToTabWithTimeoutMock = vi.fn().mockResolvedValue({ success: true });
vi.mock("../../src/background/sync/content-messaging.js", () => ({
  sendToTabWithTimeout: (...args: any[]) => sendToTabWithTimeoutMock(...args),
}));

const platform: PlatformCatalogEntry = {
  id: "mintos",
  name: "Mintos",
  enabled: true,
  strategy: "universal",
  domains: ["mintos.com"],
  login: {
    entryUrl: "https://mintos.com",
    usernameSelectors: [],
    passwordSelectors: [],
    submitSelectors: [],
    otpSelectors: ["input[name='otp']"],
    postLoginIndicators: [".dashboard"],
  },
  dashboard: {
    portfolioValueSelectors: [],
    freeCashSelectors: [],
    netAnnualReturnSelectors: [],
  },
};

describe("manual action sync flow", () => {
  beforeEach(() => {
    sendToTabWithTimeoutMock.mockReset();
    sendToTabWithTimeoutMock.mockResolvedValue({ success: true });
    vi.mocked(chrome.storage.session.set).mockClear();
    vi.mocked(chrome.storage.session.remove).mockClear();
    vi.mocked(chrome.storage.session.set).mockResolvedValue(undefined);
    vi.mocked(chrome.storage.session.remove).mockResolvedValue(undefined);
  });

  it("uses distinct user-facing progress messages for captcha and 2FA", () => {
    expect(getManualActionProgressMessage("captcha")).toBe(
      "Captcha detected — please solve it in the open tab",
    );
    expect(getManualActionProgressMessage("2fa")).toBe(
      "2FA required — please enter code in the open tab",
    );
  });

  it("focuses the tab, emits progress, and resolves once login is confirmed", async () => {
    const onEvent = vi.fn();
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(undefined);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: true });
    const notify = vi.fn().mockResolvedValue("notify-1");
    const clearNotification = vi.fn().mockResolvedValue(undefined);

    const result = await waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-1",
      log,
      onEvent,
      actionType: "2fa",
      timeoutMs: 100,
      pollMs: 1,
      focusTab,
      sendCheckLogin,
      notify,
      clearNotification,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toBe(true);
    expect(focusTab).toHaveBeenCalledWith(7);
    expect(notify).toHaveBeenCalledWith("Mintos", "2fa", 7);
    expect(clearNotification).toHaveBeenCalledWith("notify-1");
    expect(sendCheckLogin).toHaveBeenCalledWith(7, {
      postLoginIndicators: platform.login.postLoginIndicators,
      usernameSelectors: platform.login.usernameSelectors,
      passwordSelectors: platform.login.passwordSelectors,
      otpSelectors: platform.login.otpSelectors,
      afterSubmission: true,
      entryUrl: platform.login.entryUrl,
    });
    expect(onEvent).toHaveBeenCalledWith({
      type: "platform_progress",
      platformId: "mintos",
      runId: "run-1",
      message: "2FA required — please enter code in the open tab",
    });
  });

  it("waits for 2FA in the tab without creating a dashboard prompt when disabled", async () => {
    const onEvent = vi.fn();
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(undefined);
    const sendCheckLogin = vi
      .fn()
      .mockResolvedValueOnce({ loggedIn: false })
      .mockResolvedValueOnce({ loggedIn: true });
    const notify = vi.fn().mockResolvedValue("notify-tab-only");
    const clearNotification = vi.fn().mockResolvedValue(undefined);

    const result = await waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-tab-only-2fa",
      log,
      onEvent,
      actionType: "2fa",
      showDashboardPrompt: false,
      timeoutMs: 100,
      pollMs: 1,
      focusTab,
      sendCheckLogin,
      notify,
      clearNotification,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toBe(true);
    expect(focusTab).toHaveBeenCalledWith(7);
    expect(notify).toHaveBeenCalledWith("Mintos", "2fa", 7);
    expect(clearNotification).toHaveBeenCalledWith("notify-tab-only");
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
    expect(
      onEvent.mock.calls.some((call) => call[0].type === "manual_action_required"),
    ).toBe(false);
    expect(onEvent).toHaveBeenCalledWith({
      type: "platform_progress",
      platformId: "mintos",
      runId: "run-tab-only-2fa",
      message: "2FA required — please enter code in the open tab",
    });
    expect(sendCheckLogin).toHaveBeenCalledTimes(2);
  });

  it("clears notification on timeout", async () => {
    const onEvent = vi.fn();
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(undefined);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });
    const notify = vi.fn().mockResolvedValue("notify-timeout");
    const clearNotification = vi.fn().mockResolvedValue(undefined);

    const result = await waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-1",
      log,
      onEvent,
      actionType: "2fa",
      timeoutMs: 5,
      pollMs: 10,
      focusTab,
      sendCheckLogin,
      notify,
      clearNotification,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toBe(false);
    expect(notify).toHaveBeenCalledWith("Mintos", "2fa", 7);
    expect(clearNotification).toHaveBeenCalledWith("notify-timeout");
  });

  it("clears notification when sync is cancelled after notification creation", async () => {
    const onEvent = vi.fn();
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(undefined);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });
    const clearNotification = vi.fn().mockResolvedValue(undefined);
    const controller = new AbortController();
    const notify = vi.fn().mockImplementation(async () => {
      controller.abort();
      return "notify-cancelled";
    });

    await expect(
      waitForManualAction({
        tabId: 7,
        platform,
        runId: "run-1",
        log,
        onEvent,
        actionType: "2fa",
        timeoutMs: 100,
        pollMs: 1,
        signal: controller.signal,
        focusTab,
        sendCheckLogin,
        notify,
        clearNotification,
        delay: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow("Manual action cancelled");

    expect(notify).toHaveBeenCalledWith("Mintos", "2fa", 7);
    expect(clearNotification).toHaveBeenCalledWith("notify-cancelled");
    expect(sendCheckLogin).not.toHaveBeenCalled();
  });

  it("accepts dashboard submission immediately after manual action event while notification is pending", async () => {
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(undefined);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });
    const clearNotification = vi.fn().mockResolvedValue(undefined);
    let resolveNotification: (notificationId: string) => void = () => {};
    const notify = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveNotification = resolve;
        }),
    );
    let resolveResult: Promise<ManualActionResolveResult> | undefined;
    const onEvent = vi.fn((event) => {
      if (event.type !== "manual_action_required") return;
      resolveResult = resolvePendingManualAction(event.requestId, { code: "123456" });
    });

    const result = await waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-1",
      log,
      onEvent,
      actionType: "2fa",
      timeoutMs: 100,
      pollMs: 1,
      focusTab,
      sendCheckLogin,
      notify,
      clearNotification,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toBe(true);
    expect(resolveResult).toBeDefined();
    await expect(resolveResult!).resolves.toMatchObject({ success: true });
    expect(sendToTabWithTimeoutMock).toHaveBeenCalledWith(7, {
      type: "SUBMIT_OTP",
      payload: {
        code: "123456",
        otpSelectors: platform.login.otpSelectors,
        submitSelectors: platform.login.submitSelectors,
        postLoginIndicators: platform.login.postLoginIndicators,
      },
    }, 20000, undefined, undefined);

    resolveNotification("late-notify");
    await Promise.resolve();
    expect(clearNotification).toHaveBeenCalledWith("late-notify");
  });

  it("does not re-register pending action when submission fails after cancellation", async () => {
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(undefined);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });
    const notify = vi.fn().mockResolvedValue("notify-cancel-after-submit");
    const clearNotification = vi.fn().mockResolvedValue(undefined);
    const controller = new AbortController();
    let requestId = "";
    let resolveSubmit: (value: { success: boolean }) => void = () => {};
    sendToTabWithTimeoutMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    let manualEventSeen: () => void = () => {};
    const manualEventPromise = new Promise<void>((resolve) => {
      manualEventSeen = resolve;
    });
    let firstResolveResult: Promise<ManualActionResolveResult> | undefined;
    const onEvent = vi.fn((event) => {
      if (event.type !== "manual_action_required") return;
      requestId = event.requestId;
      firstResolveResult = resolvePendingManualAction(event.requestId, { code: "123456" });
      manualEventSeen();
    });

    const promise = waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-1",
      log,
      onEvent,
      actionType: "2fa",
      timeoutMs: 100,
      pollMs: 1,
      signal: controller.signal,
      focusTab,
      sendCheckLogin,
      notify,
      clearNotification,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    await manualEventPromise;
    controller.abort();
    await expect(promise).rejects.toThrow("Manual action cancelled");

    resolveSubmit({ success: false });
    await Promise.resolve();

    expect(firstResolveResult).toBeDefined();
    await expect(firstResolveResult!).resolves.toMatchObject({ success: false });
    await expect(resolvePendingManualAction(requestId, { code: "654321" })).resolves.toMatchObject({ success: false });
  });

  it("resolves via dashboard OTP submission", async () => {
    const onEvent = vi.fn();
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(undefined);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });

    // Start waitForManualAction in background
    const promise = waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-1",
      log,
      onEvent,
      actionType: "2fa",
      timeoutMs: 5000,
      pollMs: 100,
      focusTab,
      sendCheckLogin,
      delay: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10))),
    });

    // Wait a brief moment for the event to be emitted
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Find the emitted manual_action_required event
    const manualActionReqEvent = onEvent.mock.calls.find(
      (call) => call[0].type === "manual_action_required",
    );
    expect(manualActionReqEvent).toBeDefined();
    if (!manualActionReqEvent) {
      throw new Error("manual_action_required event not emitted");
    }
    const requestId = manualActionReqEvent[0].requestId;
    expect(requestId).toBeDefined();

    // Resolve it with code "123456"
    const resolved = await resolvePendingManualAction(requestId, { code: "123456" });
    expect(resolved).toMatchObject({ success: true });

    const result = await promise;
    expect(result).toBe(true);

    // Verify SUBMIT_OTP message was sent to the tab
    expect(sendToTabWithTimeoutMock).toHaveBeenCalledWith(7, {
      type: "SUBMIT_OTP",
      payload: {
        code: "123456",
        otpSelectors: platform.login.otpSelectors,
        submitSelectors: platform.login.submitSelectors,
        postLoginIndicators: platform.login.postLoginIndicators,
      },
    }, 20000, undefined, undefined);
  });

  it("ignores duplicate concurrent dashboard OTP submissions", async () => {
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(undefined);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });
    const notify = vi.fn().mockResolvedValue(undefined);
    let resolveSubmit: (value: { success: boolean }) => void = () => {};
    sendToTabWithTimeoutMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    let requestId = "";
    let manualEventSeen: () => void = () => {};
    const manualEventPromise = new Promise<void>((resolve) => {
      manualEventSeen = resolve;
    });
    const onEvent = vi.fn((event) => {
      if (event.type !== "manual_action_required") return;
      requestId = event.requestId;
      manualEventSeen();
    });

    const promise = waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-duplicate-otp",
      log,
      onEvent,
      actionType: "2fa",
      timeoutMs: 5000,
      pollMs: 100,
      focusTab,
      sendCheckLogin,
      notify,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    await manualEventPromise;
    const firstResolve = resolvePendingManualAction(requestId, { code: "123456" });
    const secondResolve = resolvePendingManualAction(requestId, { code: "654321" });

    // Rejected, but NOT reported as gone: the first verification is still in
    // flight, and `gone` would make the dashboard close the modal and record a
    // final sync error while that attempt can still succeed.
    const second = await secondResolve;
    expect(second).toMatchObject({ success: false });
    expect(second.gone).toBeUndefined();
    expect(sendToTabWithTimeoutMock).toHaveBeenCalledTimes(1);
    expect(sendToTabWithTimeoutMock).toHaveBeenCalledWith(7, {
      type: "SUBMIT_OTP",
      payload: expect.objectContaining({ code: "123456" }),
    }, 20000, undefined, undefined);

    resolveSubmit({ success: true });
    await expect(firstResolve).resolves.toMatchObject({ success: true });
    await expect(promise).resolves.toBe(true);
    expect(sendToTabWithTimeoutMock).toHaveBeenCalledTimes(1);
  });

  it("restores pending OTP action after failed dashboard submission", async () => {
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(undefined);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });
    const notify = vi.fn().mockResolvedValue(undefined);
    sendToTabWithTimeoutMock
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true });
    let requestId = "";
    let manualEventSeen: () => void = () => {};
    const manualEventPromise = new Promise<void>((resolve) => {
      manualEventSeen = resolve;
    });
    const onEvent = vi.fn((event) => {
      if (event.type !== "manual_action_required") return;
      requestId = event.requestId;
      manualEventSeen();
    });

    const promise = waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-otp-retry",
      log,
      onEvent,
      actionType: "2fa",
      timeoutMs: 5000,
      pollMs: 100,
      focusTab,
      sendCheckLogin,
      notify,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    await manualEventPromise;

    await expect(
      resolvePendingManualAction(requestId, { code: "111111" }),
    ).resolves.toMatchObject({ success: false });
    await expect(
      resolvePendingManualAction(requestId, { code: "222222" }),
    ).resolves.toMatchObject({ success: true });
    await expect(promise).resolves.toBe(true);

    expect(sendToTabWithTimeoutMock).toHaveBeenCalledTimes(2);
    expect(sendToTabWithTimeoutMock.mock.calls[0]?.[1]).toMatchObject({
      payload: { code: "111111" },
    });
    expect(sendToTabWithTimeoutMock.mock.calls[1]?.[1]).toMatchObject({
      payload: { code: "222222" },
    });
  });

  it("waits for persisted manual action cleanup before reporting dashboard resolve success", async () => {
    const onEvent = vi.fn();
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(undefined);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });
    const notify = vi.fn().mockResolvedValue(undefined);
    let resolveRemove: () => void = () => {};
    vi.mocked(chrome.storage.session.remove).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        }),
    );

    const promise = waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-cleanup",
      log,
      onEvent,
      actionType: "2fa",
      timeoutMs: 5000,
      pollMs: 100,
      focusTab,
      sendCheckLogin,
      notify,
      delay: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10))),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const manualActionReqEvent = onEvent.mock.calls.find(
      (call) => call[0].type === "manual_action_required",
    );
    if (!manualActionReqEvent) {
      throw new Error("manual_action_required event not emitted");
    }

    const resolved = resolvePendingManualAction(
      manualActionReqEvent[0].requestId,
      { code: "123456" },
    );
    const marker = vi.fn();
    void resolved.then(marker);
    await Promise.resolve();

    expect(marker).not.toHaveBeenCalled();
    resolveRemove();

    await expect(resolved).resolves.toMatchObject({ success: true });
    await expect(promise).resolves.toBe(true);
  });

  it("keeps successful OTP verification when persisted cleanup fails", async () => {
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(undefined);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });
    const notify = vi.fn().mockResolvedValue(undefined);
    vi.mocked(chrome.storage.session.remove).mockRejectedValueOnce(
      new Error("session remove failed"),
    );
    let requestId = "";
    let resolveResult: Promise<ManualActionResolveResult> | undefined;
    const onEvent = vi.fn((event) => {
      if (event.type !== "manual_action_required") return;
      requestId = event.requestId;
      resolveResult = resolvePendingManualAction(event.requestId, { code: "123456" });
    });

    const promise = waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-cleanup-fail",
      log,
      onEvent,
      actionType: "2fa",
      timeoutMs: 5000,
      pollMs: 100,
      focusTab,
      sendCheckLogin,
      notify,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    await expect(promise).resolves.toBe(true);
    expect(resolveResult).toBeDefined();
    await expect(resolveResult!).resolves.toMatchObject({ success: true });
    expect(log).toHaveBeenCalledWith(
      "Failed to clear persisted manual action",
      "session remove failed",
      "warn",
    );
    await expect(
      resolvePendingManualAction(requestId, { code: "123456" }),
    ).resolves.toMatchObject({ success: false });
  });

  it("keeps successful Captcha confirmation when persisted cleanup fails", async () => {
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(undefined);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: true });
    const notify = vi.fn().mockResolvedValue(undefined);
    vi.mocked(chrome.storage.session.remove).mockRejectedValueOnce(
      new Error("session remove failed"),
    );
    let resolveResult: Promise<ManualActionResolveResult> | undefined;
    const onEvent = vi.fn((event) => {
      if (event.type !== "manual_action_required") return;
      resolveResult = resolvePendingManualAction(event.requestId);
    });

    const promise = waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-captcha-cleanup-fail",
      log,
      onEvent,
      actionType: "captcha",
      timeoutMs: 5000,
      pollMs: 100,
      focusTab,
      sendCheckLogin,
      notify,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    await expect(promise).resolves.toBe(true);
    expect(resolveResult).toBeDefined();
    await expect(resolveResult!).resolves.toMatchObject({ success: true });
    expect(log).toHaveBeenCalledWith(
      "Failed to clear persisted manual action",
      "session remove failed",
      "warn",
    );
  });
  it("surfaces a concrete reason when the captcha confirmation cannot verify the login", async () => {
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(true);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });
    const notify = vi.fn().mockResolvedValue(undefined);
    let resolveResult: Promise<ManualActionResolveResult> | undefined;
    const onEvent = vi.fn((event) => {
      if (event.type !== "manual_action_required") return;
      resolveResult = resolvePendingManualAction(event.requestId);
    });

    const promise = waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-captcha-unverified",
      log,
      onEvent,
      actionType: "captcha",
      timeoutMs: 30,
      pollMs: 100,
      focusTab,
      sendCheckLogin,
      notify,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    await expect(promise).resolves.toBe(false);
    expect(resolveResult).toBeDefined();
    await expect(resolveResult!).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("still reports a security check"),
    });
  });

  it("reports a closed tab instead of a generic failure", async () => {
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(true);
    const sendCheckLogin = vi
      .fn()
      .mockRejectedValue(new Error("No tab with id: 7"));
    const notify = vi.fn().mockResolvedValue(undefined);
    let resolveResult: Promise<ManualActionResolveResult> | undefined;
    const onEvent = vi.fn((event) => {
      if (event.type !== "manual_action_required") return;
      resolveResult = resolvePendingManualAction(event.requestId);
    });

    const promise = waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-captcha-tab-gone",
      log,
      onEvent,
      actionType: "captcha",
      timeoutMs: 30,
      pollMs: 100,
      focusTab,
      sendCheckLogin,
      notify,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    await expect(promise).resolves.toBe(false);
    await expect(resolveResult!).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("no longer open"),
    });
  });

  it("continues the sync when the captcha wait is force-resolved", async () => {
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(true);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });
    const notify = vi.fn().mockResolvedValue(undefined);
    let resolveResult: Promise<ManualActionResolveResult> | undefined;
    const onEvent = vi.fn((event) => {
      if (event.type !== "manual_action_required") return;
      resolveResult = resolvePendingManualAction(event.requestId, { force: true });
    });

    const promise = waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-captcha-force",
      log,
      onEvent,
      actionType: "captcha",
      timeoutMs: 5000,
      pollMs: 100,
      focusTab,
      sendCheckLogin,
      notify,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    await expect(promise).resolves.toBe(true);
    await expect(resolveResult!).resolves.toMatchObject({ success: true });
    // The whole point of the override: no verification round-trip.
    expect(sendCheckLogin).not.toHaveBeenCalled();
  });

  it("ends the wait as soon as the platform tab is closed", async () => {
    const log = vi.fn();
    const onEvent = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(true);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });
    const notify = vi.fn().mockResolvedValue(undefined);
    let closeTab: () => void = () => {};
    const unwatch = vi.fn();
    const watchTabRemoval = vi.fn((_tabId: number, onRemoved: () => void) => {
      closeTab = onRemoved;
      return unwatch;
    });

    const promise = waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-tab-closed",
      log,
      onEvent,
      actionType: "captcha",
      // Long enough that passing would be impossible without the listener.
      timeoutMs: 60_000,
      pollMs: 50_000,
      focusTab,
      sendCheckLogin,
      notify,
      watchTabRemoval,
      delay: vi.fn().mockImplementation(() => new Promise(() => {})),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(watchTabRemoval).toHaveBeenCalledWith(7, expect.any(Function));
    closeTab();

    await expect(promise).resolves.toBe(false);
    expect(unwatch).toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith({
      type: "platform_progress",
      platformId: "mintos",
      runId: "run-tab-closed",
      message: "Tab was closed before the security check was completed",
    });
  });

  it("reports the request as gone when the service worker restarted", async () => {
    // chrome.storage.session.get is overloaded; the mock resolves to the record
    // form here, which vi.mocked() cannot infer.
    (
      vi.mocked(chrome.storage.session.get) as unknown as {
        mockResolvedValueOnce: (value: unknown) => void;
      }
    ).mockResolvedValueOnce({
      p2p_pending_manual_action: {
        requestId: "orphaned-request",
        runId: "run-old",
        platformId: "mintos",
        platformName: "Mintos",
        actionType: "captcha",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    await expect(
      resolvePendingManualAction("orphaned-request"),
    ).resolves.toMatchObject({ success: false, gone: true });
    expect(chrome.storage.session.remove).toHaveBeenCalledWith(
      "p2p_pending_manual_action",
    );
  });

  it("tells the user the tab could not be surfaced", async () => {
    const log = vi.fn();
    const onEvent = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(false);
    const sendCheckLogin = vi.fn().mockResolvedValue({ loggedIn: false });
    const notify = vi.fn().mockResolvedValue(undefined);

    await waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-focus-failed",
      log,
      onEvent,
      actionType: "captcha",
      timeoutMs: 5,
      pollMs: 10,
      focusTab,
      sendCheckLogin,
      notify,
      delay: vi.fn().mockResolvedValue(undefined),
    });

    const requiredEvent = onEvent.mock.calls.find(
      (call) => call[0].type === "manual_action_required",
    );
    expect(requiredEvent?.[0].message).toContain(
      "could not be brought to the front",
    );
  });

  it("does not report a double-clicked captcha confirmation as gone", async () => {
    const log = vi.fn();
    const focusTab = vi.fn().mockResolvedValue(true);
    let releaseCheck: (r: { loggedIn: boolean }) => void = () => {};
    const sendCheckLogin = vi.fn().mockImplementation(
      () => new Promise((resolve) => { releaseCheck = resolve; }),
    );
    const notify = vi.fn().mockResolvedValue(undefined);
    let requestId = "";
    const onEvent = vi.fn((event) => {
      if (event.type === "manual_action_required") requestId = event.requestId;
    });

    const promise = waitForManualAction({
      tabId: 7,
      platform,
      runId: "run-captcha-double-click",
      log,
      onEvent,
      actionType: "captcha",
      timeoutMs: 5000,
      pollMs: 100,
      focusTab,
      sendCheckLogin,
      notify,
      delay: vi.fn().mockImplementation(() => new Promise(() => {})),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requestId).not.toBe("");

    // The user clicks "Done / Solved" twice while the first CHECK_LOGIN is
    // still in flight — the exact impatient double-click this guard exists for.
    const first = resolvePendingManualAction(requestId);
    const second = await resolvePendingManualAction(requestId);

    expect(second).toMatchObject({ success: false });
    expect(second.gone).toBeUndefined();

    // The first attempt then succeeds and must still carry the sync through.
    releaseCheck({ loggedIn: true });
    await expect(first).resolves.toMatchObject({ success: true });
    await expect(promise).resolves.toBe(true);
  });
});

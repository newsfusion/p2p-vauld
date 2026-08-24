import { vi } from "vitest";

vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("")));
if (typeof window !== "undefined" && "happyDOM" in window) {
  (window as any).happyDOM.settings.disableJavaScriptFileLoading = true;
  (window as any).happyDOM.settings.disableJavaScriptEvaluation = true;
  (window as any).happyDOM.settings.disableCSSFileLoading = true;
  (window as any).happyDOM.settings.enableFileSystemHttpRequests = false;
  (window as any).happyDOM.setURL("http://localhost");
}

vi.stubGlobal("chrome", {
  storage: {
    local: { get: vi.fn(), set: vi.fn() },
    session: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
  },
  runtime: {
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn(),
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
    setTitle: vi.fn(),
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
});

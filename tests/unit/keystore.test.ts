import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listCredentialPlatformIdsMock = vi.fn(async (): Promise<string[]> => []);
const getCredentialsMock = vi.fn();
const saveCredentialsMock = vi.fn();
const getStoredInvisibleKeyMock = vi.fn();
const setStoredInvisibleKeyMock = vi.fn();
const deleteStoredInvisibleKeyMock = vi.fn();
const hasStoredInvisibleKeyMock = vi.fn();

function installChromeStorageMocks() {
  const localStorage = new Map<string, unknown>();
  const sessionStorage = new Map<string, unknown>();

  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const keyList = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(
            keyList.map((key) => [key, localStorage.get(key)]),
          );
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) {
            localStorage.set(key, value);
          }
        }),
        remove: vi.fn(async (key: string) => {
          localStorage.delete(key);
        }),
      },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStorage.get(key) })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) {
            sessionStorage.set(key, value);
          }
        }),
        remove: vi.fn(async (key: string) => {
          sessionStorage.delete(key);
        }),
      },
    },
    alarms: {
      clear: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined),
    },
  };
}

describe("background keystore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    installChromeStorageMocks();

    listCredentialPlatformIdsMock.mockResolvedValue([]);
    getCredentialsMock.mockResolvedValue(undefined);
    saveCredentialsMock.mockResolvedValue(undefined);
    getStoredInvisibleKeyMock.mockResolvedValue(undefined);
    setStoredInvisibleKeyMock.mockResolvedValue(undefined);
    deleteStoredInvisibleKeyMock.mockResolvedValue(undefined);
    hasStoredInvisibleKeyMock.mockResolvedValue(false);

    vi.doMock("../../src/background/db-proxy.js", () => ({
      listCredentialPlatformIds: () => listCredentialPlatformIdsMock(),
      getCredentials: (...args: unknown[]) => getCredentialsMock(...args),
      saveCredentials: (...args: unknown[]) => saveCredentialsMock(...args),
      getStoredInvisibleKey: (...args: unknown[]) =>
        getStoredInvisibleKeyMock(...args),
      setStoredInvisibleKey: (...args: unknown[]) =>
        setStoredInvisibleKeyMock(...args),
      deleteStoredInvisibleKey: (...args: unknown[]) =>
        deleteStoredInvisibleKeyMock(...args),
      hasStoredInvisibleKey: (...args: unknown[]) =>
        hasStoredInvisibleKeyMock(...args),
    }));
    vi.doMock("../../src/shared/crypto/index.js", () => ({
      generateRandomKey: vi.fn(async () => ({ kind: "invisible-key" })),
      exportKeyToBase64: vi.fn(async (key: { kind?: string }) => `${key.kind}-b64`),
      importKeyFromBase64: vi.fn(async (keyB64: string) => ({ keyB64 })),
      deriveKeyFromPassword: vi.fn(async () => ({ kind: "master-key" })),
      generateSalt: vi.fn(() => "salt"),
      deriveVerificationHash: vi.fn(async () => "verify-hash"),
      credentialAad: vi.fn((platformId: string, field: string) => `${platformId}:${field}`),
      encrypt: vi.fn(async () => ({ iv: "iv", ciphertext: "ciphertext" })),
      decrypt: vi.fn(async () => "plaintext"),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads only the demo session key when both runtime scopes exist", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true");
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    await chromeApi.storage.local.set({
      p2p_has_master_password: true,
      "demo:p2p_has_master_password": false,
    });
    await chromeApi.storage.session.set({
      p2p_session_key_b64: "production-key-b64",
      "demo:p2p_session_key_b64": "demo-key-b64",
    });

    const { getEncryptionKey, hasMasterPassword } = await import(
      "../../src/background/keystore.js"
    );

    await expect(hasMasterPassword()).resolves.toBe(false);
    await expect(getEncryptionKey()).resolves.toEqual({
      keyB64: "demo-key-b64",
    });
  });

  it("stores invisible key in IndexedDB storage and mirrors it to session", async () => {
    const { initInvisibleKey } = await import("../../src/background/keystore.js");
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;

    await initInvisibleKey();

    expect(setStoredInvisibleKeyMock).toHaveBeenCalledWith("invisible-key-b64");
    expect(chromeApi.storage.local.set).toHaveBeenCalledWith({
      p2p_has_master_password: false,
    });
    expect(chromeApi.storage.session.set).toHaveBeenCalledWith({
      p2p_session_key_b64: "invisible-key-b64",
    });
  });

  it("restores invisible key from session before IndexedDB", async () => {
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    await chromeApi.storage.session.set({
      p2p_session_key_b64: "session-key-b64",
    });

    const { getEncryptionKey } = await import("../../src/background/keystore.js");

    await expect(getEncryptionKey()).resolves.toEqual({
      keyB64: "session-key-b64",
    });
    expect(getStoredInvisibleKeyMock).not.toHaveBeenCalled();
  });

  it("detects first run from IndexedDB invisible key and master flag", async () => {
    const { isFirstRun } = await import("../../src/background/keystore.js");

    await expect(isFirstRun()).resolves.toBe(true);

    hasStoredInvisibleKeyMock.mockResolvedValueOnce(true);
    await expect(isFirstRun()).resolves.toBe(false);
  });

  it("deletes IndexedDB invisible key when master password setup succeeds", async () => {
    getStoredInvisibleKeyMock.mockResolvedValue("invisible-key-b64");
    const { setupMasterPassword, unlockWithMasterPassword } = await import(
      "../../src/background/keystore.js"
    );
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;

    await setupMasterPassword("correct horse");

    expect(deleteStoredInvisibleKeyMock).toHaveBeenCalled();
    expect(chromeApi.storage.session.remove).toHaveBeenCalledWith(
      "p2p_session_key_b64",
    );

    vi.mocked(chromeApi.storage.session.set).mockClear();
    const unlocked = await unlockWithMasterPassword("correct horse");
    expect(unlocked).toBe(true);
    expect(chromeApi.storage.session.set).not.toHaveBeenCalled();
  });

  it("re-encrypts every stored credential before removing the invisible key", async () => {
    getStoredInvisibleKeyMock.mockResolvedValue("invisible-key-b64");
    listCredentialPlatformIdsMock.mockResolvedValue(["mintos", "peerberry"]);
    getCredentialsMock.mockImplementation(async (platformId: string) => ({
      platformId,
      encryptedUsername: { iv: `${platformId}-user-iv`, ciphertext: "user" },
      encryptedPassword: { iv: `${platformId}-pass-iv`, ciphertext: "pass" },
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    const { setupMasterPassword } = await import(
      "../../src/background/keystore.js"
    );

    await setupMasterPassword("x");

    expect(saveCredentialsMock).toHaveBeenCalledTimes(2);
    expect(saveCredentialsMock.mock.calls.map(([value]) => value.platformId)).toEqual([
      "mintos",
      "peerberry",
    ]);
    expect(deleteStoredInvisibleKeyMock).toHaveBeenCalledTimes(1);
  });

  it("refuses master-password setup when credentials exist without a decrypting key", async () => {
    listCredentialPlatformIdsMock.mockResolvedValue(["mintos"]);
    const { setupMasterPassword } = await import(
      "../../src/background/keystore.js"
    );
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;

    await expect(setupMasterPassword("x")).rejects.toThrow(
      "Cannot migrate stored credentials without the existing encryption key",
    );

    expect(getCredentialsMock).not.toHaveBeenCalled();
    expect(saveCredentialsMock).not.toHaveBeenCalled();
    expect(chromeApi.storage.local.set).not.toHaveBeenCalled();
    expect(deleteStoredInvisibleKeyMock).not.toHaveBeenCalled();
  });

  it("rolls back migrated credentials when re-encryption persistence fails", async () => {
    getStoredInvisibleKeyMock.mockResolvedValue("invisible-key-b64");
    listCredentialPlatformIdsMock.mockResolvedValue(["mintos", "peerberry"]);
    const originals = new Map([
      ["mintos", {
        platformId: "mintos",
        encryptedUsername: { iv: "mintos-user-iv", ciphertext: "user" },
        encryptedPassword: { iv: "mintos-pass-iv", ciphertext: "pass" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      ["peerberry", {
        platformId: "peerberry",
        encryptedUsername: { iv: "peerberry-user-iv", ciphertext: "user" },
        encryptedPassword: { iv: "peerberry-pass-iv", ciphertext: "pass" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    ]);
    getCredentialsMock.mockImplementation(async (platformId: string) =>
      originals.get(platformId),
    );
    saveCredentialsMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce(undefined);
    const { setupMasterPassword } = await import(
      "../../src/background/keystore.js"
    );

    await expect(setupMasterPassword("x")).rejects.toThrow("write failed");

    expect(saveCredentialsMock).toHaveBeenCalledTimes(3);
    expect(saveCredentialsMock.mock.calls[2]?.[0]).toBe(originals.get("mintos"));
    expect(deleteStoredInvisibleKeyMock).not.toHaveBeenCalled();
  });

  it("replaces an active timeout without clearing it first", async () => {
    const { resetSessionTimeout } = await import(
      "../../src/background/keystore.js"
    );
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;

    await resetSessionTimeout(15);

    expect(chromeApi.alarms.create).toHaveBeenCalledWith(
      "p2p_session_timeout",
      { delayInMinutes: 15 },
    );
    expect(chromeApi.alarms.clear).not.toHaveBeenCalled();
  });
});

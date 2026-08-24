import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateRandomKey } from "../../src/shared/crypto/index.js";
import {
  clearCredentialPrefill,
  getCredentialPrefill,
  removeUnsafeCredentialPrefill,
  saveCredentialPrefill,
} from "../../src/background/credential-prefill.js";
import { RUNTIME_NAMES } from "../../src/shared/runtime-names.js";

describe("credential prefill storage", () => {
  const sessionState: Record<string, unknown> = {};

  beforeEach(() => {
    for (const key of Object.keys(sessionState)) delete sessionState[key];
    vi.mocked(chrome.storage.session.get).mockClear();
    vi.mocked(chrome.storage.session.set).mockClear();
    vi.mocked(chrome.storage.session.remove).mockClear();

    vi.mocked(chrome.storage.session.get).mockImplementation(async (key) => {
      const storageKey = String(key);
      return { [storageKey]: sessionState[storageKey] };
    });
    vi.mocked(chrome.storage.session.set).mockImplementation(async (items) => {
      Object.assign(sessionState, items);
    });
    vi.mocked(chrome.storage.session.remove).mockImplementation(async (key) => {
      delete sessionState[String(key)];
    });
  });

  it("stores only an encrypted username and decrypts it with the active key", async () => {
    const key = await generateRandomKey();
    const username = "unique-prefill@example.test";

    await saveCredentialPrefill(key, username);

    const stored = sessionState[RUNTIME_NAMES.credentialPrefill];
    expect(stored).toEqual({
      version: 1,
      encryptedUsername: {
        iv: expect.any(String),
        ciphertext: expect.any(String),
      },
    });
    expect(JSON.stringify(stored)).not.toContain(username);
    await expect(getCredentialPrefill(key)).resolves.toBe(username);
  });

  it("deletes a legacy plaintext username instead of returning it", async () => {
    sessionState[RUNTIME_NAMES.credentialPrefill] = "legacy@example.test";
    const key = await generateRandomKey();

    await expect(getCredentialPrefill(key)).resolves.toBe("");

    expect(chrome.storage.session.remove).toHaveBeenCalledWith(
      RUNTIME_NAMES.credentialPrefill,
    );
    expect(sessionState[RUNTIME_NAMES.credentialPrefill]).toBeUndefined();
  });

  it("deletes a prefill that fails authenticated decryption", async () => {
    const key = await generateRandomKey();
    const wrongKey = await generateRandomKey();
    await saveCredentialPrefill(key, "prefill@example.test");

    await expect(getCredentialPrefill(wrongKey)).resolves.toBe("");

    expect(sessionState[RUNTIME_NAMES.credentialPrefill]).toBeUndefined();
  });

  it("clears the encrypted prefill when the encryption key changes", async () => {
    sessionState[RUNTIME_NAMES.credentialPrefill] = {
      version: 1,
      encryptedUsername: { iv: "iv", ciphertext: "ciphertext" },
    };

    await clearCredentialPrefill();

    expect(sessionState[RUNTIME_NAMES.credentialPrefill]).toBeUndefined();
  });

  it("preserves a valid encrypted prefill during extension updates", async () => {
    const key = await generateRandomKey();
    await saveCredentialPrefill(key, "preserved@example.test");
    const stored = sessionState[RUNTIME_NAMES.credentialPrefill];

    await removeUnsafeCredentialPrefill();

    expect(sessionState[RUNTIME_NAMES.credentialPrefill]).toBe(stored);
    expect(chrome.storage.session.remove).not.toHaveBeenCalled();
  });

  it("removes a legacy plaintext prefill during extension updates", async () => {
    sessionState[RUNTIME_NAMES.credentialPrefill] = "legacy@example.test";

    await removeUnsafeCredentialPrefill();

    expect(sessionState[RUNTIME_NAMES.credentialPrefill]).toBeUndefined();
  });
});

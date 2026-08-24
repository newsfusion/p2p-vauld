/**
 * Keystore — manages the AES-GCM encryption key for the session.
 *
 * Two modes:
 * 1. "Invisible key" (no master password): random key generated on first run,
 *    stored as base64 in extension IndexedDB.
 * 2. "Master password" mode: key is derived via PBKDF2 and kept only in
 *    service-worker memory until lock/SW restart.
 */

import {
  generateRandomKey,
  exportKeyToBase64,
  importKeyFromBase64,
  deriveKeyFromPassword,
  generateSalt,
  deriveVerificationHash,
  encrypt,
  decrypt,
  credentialAad,
} from '../shared/crypto/index.js';
import {
  listCredentialPlatformIds,
  getCredentials,
  saveCredentials,
  deleteStoredInvisibleKey,
  getStoredInvisibleKey,
  hasStoredInvisibleKey,
  setStoredInvisibleKey,
} from './db-proxy.js';
import { RUNTIME_NAMES } from "../shared/runtime-names.js";

const STORAGE_KEY_SALT = RUNTIME_NAMES.keySalt;
const STORAGE_KEY_VERIFY_SALT = RUNTIME_NAMES.verifySalt;
const STORAGE_KEY_VERIFY_HASH = RUNTIME_NAMES.verifyHash;
const STORAGE_KEY_HAS_MASTER = RUNTIME_NAMES.hasMasterPassword;
const SESSION_STORAGE_KEY = RUNTIME_NAMES.sessionKey;

// ─── Session key cache (in-memory, restored from session storage on SW restart) ─

let sessionKey: CryptoKey | null = null;

export function setSessionKey(key: CryptoKey): void {
  sessionKey = key;
}

async function persistInvisibleSessionKey(key: CryptoKey): Promise<void> {
  const keyB64 = await exportKeyToBase64(key);
  await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: keyB64 });
}

export async function getEncryptionKey(): Promise<CryptoKey | null> {
  // Return in-memory key if available
  if (sessionKey) return sessionKey;

  const result = await chrome.storage.local.get(STORAGE_KEY_HAS_MASTER);
  if (result[STORAGE_KEY_HAS_MASTER]) {
    // Master password mode — key stays in memory only and must be re-unlocked
    return null;
  }

  // Try session storage (survives SW restart)
  const session = await chrome.storage.session.get(SESSION_STORAGE_KEY);
  if (session[SESSION_STORAGE_KEY]) {
    const key = await importKeyFromBase64(session[SESSION_STORAGE_KEY] as string);
    sessionKey = key;
    return key;
  }

  // Try invisible key from extension IndexedDB
  const storedInvisibleKey = await getStoredInvisibleKey();
  if (storedInvisibleKey) {
    const key = await importKeyFromBase64(storedInvisibleKey);
    sessionKey = key;
    return key;
  }

  return null;
}

// ─── Invisible key mode ───────────────────────────────────────────────────────

export async function initInvisibleKey(): Promise<void> {
  const existing = await getStoredInvisibleKey();
  if (existing) {
    // Already initialized
    const key = await importKeyFromBase64(existing);
    sessionKey = key;
    await persistInvisibleSessionKey(key);
    return;
  }

  const key = await generateRandomKey();
  const keyBase64 = await exportKeyToBase64(key);
  await setStoredInvisibleKey(keyBase64);
  await chrome.storage.local.set({ [STORAGE_KEY_HAS_MASTER]: false });
  sessionKey = key;
  await persistInvisibleSessionKey(key);
}

// ─── Master password mode ─────────────────────────────────────────────────────

export async function setupMasterPassword(masterPassword: string): Promise<void> {
  const salt = generateSalt();
  const verifySalt = generateSalt();
  const originalInvisibleKey = await getStoredInvisibleKey();

  // Get the old key before switching — needed to re-encrypt existing credentials
  const oldKey = await getEncryptionKey();
  const platformIds = await listCredentialPlatformIds();
  if (platformIds.length > 0 && !oldKey) {
    throw new Error(
      "Cannot migrate stored credentials without the existing encryption key",
    );
  }

  const newKey = await deriveKeyFromPassword(masterPassword, salt);
  const verifyHash = await deriveVerificationHash(masterPassword, verifySalt);

  const stagedCredentials: Array<{
    original: NonNullable<Awaited<ReturnType<typeof getCredentials>>>;
    migrated: NonNullable<Awaited<ReturnType<typeof getCredentials>>>;
  }> = [];

  // Re-encrypt all existing credentials with the new key, but do not commit
  // anything until every credential has been staged successfully.
  if (oldKey) {
    for (const platformId of platformIds) {
      const stored = await getCredentials(platformId);
      if (!stored) continue;
      const plaintext = {
        username: "",
        password: "",
      };
      try {
        plaintext.username = await decrypt(
          oldKey,
          stored.encryptedUsername,
          credentialAad(platformId, "username"),
        );
        plaintext.password = await decrypt(
          oldKey,
          stored.encryptedPassword,
          credentialAad(platformId, "password"),
        );
        const encryptedUsername = await encrypt(
          newKey,
          plaintext.username,
          credentialAad(platformId, "username"),
        );
        const encryptedPassword = await encrypt(
          newKey,
          plaintext.password,
          credentialAad(platformId, "password"),
        );
        stagedCredentials.push({
          original: stored,
          migrated: {
            ...stored,
            encryptedUsername,
            encryptedPassword,
            updatedAt: new Date().toISOString(),
          },
        });
      } finally {
        plaintext.username = "";
        plaintext.password = "";
      }
    }
  }

  const migratedPlatformIds: string[] = [];
  let metadataCommitted = false;
  try {
    for (const staged of stagedCredentials) {
      await saveCredentials(staged.migrated);
      migratedPlatformIds.push(staged.original.platformId);
    }

    await chrome.storage.local.set({
      [STORAGE_KEY_SALT]: salt,
      [STORAGE_KEY_VERIFY_SALT]: verifySalt,
      [STORAGE_KEY_VERIFY_HASH]: verifyHash,
      [STORAGE_KEY_HAS_MASTER]: true,
    });
    metadataCommitted = true;
    // Remove invisible key — credentials are now encrypted with the master-password-derived key
    await deleteStoredInvisibleKey();
    try {
      await chrome.storage.session.remove(SESSION_STORAGE_KEY);
    } catch {
      // Master mode ignores session storage; stale invisible-session cleanup is best effort.
    }

    sessionKey = newKey;
  } catch (error) {
    for (const staged of [...stagedCredentials].reverse()) {
      if (!migratedPlatformIds.includes(staged.original.platformId)) continue;
      try {
        await saveCredentials(staged.original);
      } catch {
        // Best-effort rollback; preserve the original error for callers.
      }
    }
    if (metadataCommitted) {
      try {
        const rollbackOperations: Array<Promise<void>> = [
          chrome.storage.local.remove(STORAGE_KEY_SALT),
          chrome.storage.local.remove(STORAGE_KEY_VERIFY_SALT),
          chrome.storage.local.remove(STORAGE_KEY_VERIFY_HASH),
          chrome.storage.local.set({ [STORAGE_KEY_HAS_MASTER]: false }),
        ];
        if (originalInvisibleKey !== undefined) {
          rollbackOperations.push(
            setStoredInvisibleKey(originalInvisibleKey),
          );
        }
        await Promise.all(rollbackOperations);
      } catch {
        // Best-effort rollback; preserve the original error for callers.
      }
    }
    sessionKey = oldKey;
    throw error;
  }
}

export async function unlockWithMasterPassword(masterPassword: string): Promise<boolean> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY_SALT,
    STORAGE_KEY_VERIFY_SALT,
    STORAGE_KEY_VERIFY_HASH,
  ]);

  const salt = stored[STORAGE_KEY_SALT] as string | undefined;
  const verifySalt = stored[STORAGE_KEY_VERIFY_SALT] as string | undefined;
  const storedHash = stored[STORAGE_KEY_VERIFY_HASH] as string | undefined;

  if (!salt || !verifySalt || !storedHash) return false;

  const hash = await deriveVerificationHash(masterPassword, verifySalt);
  if (hash !== storedHash) return false;

  const key = await deriveKeyFromPassword(masterPassword, salt);
  sessionKey = key;
  return true;
}

export async function lockSession(): Promise<void> {
  sessionKey = null;
  await chrome.storage.session.remove(SESSION_STORAGE_KEY);
  await clearSessionTimeout();
}

// ─── Session auto-lock timeout ───────────────────────────────────────────────

const SESSION_TIMEOUT_ALARM = RUNTIME_NAMES.sessionTimeoutAlarm;

export async function resetSessionTimeout(timeoutMinutes: number): Promise<void> {
  if (timeoutMinutes > 0) {
    await chrome.alarms.create(SESSION_TIMEOUT_ALARM, { delayInMinutes: timeoutMinutes });
  } else {
    await chrome.alarms.clear(SESSION_TIMEOUT_ALARM);
  }
}

export async function clearSessionTimeout(): Promise<void> {
  await chrome.alarms.clear(SESSION_TIMEOUT_ALARM);
}

export const SESSION_TIMEOUT_ALARM_NAME = SESSION_TIMEOUT_ALARM;

export async function hasMasterPassword(): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEY_HAS_MASTER);
  return result[STORAGE_KEY_HAS_MASTER] === true;
}

export async function isFirstRun(): Promise<boolean> {
  const result = await chrome.storage.local.get(STORAGE_KEY_HAS_MASTER);
  return !(await hasStoredInvisibleKey()) && !result[STORAGE_KEY_HAS_MASTER];
}

export { hasStoredInvisibleKey as hasInvisibleKey };

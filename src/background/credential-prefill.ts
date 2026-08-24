import { RUNTIME_NAMES } from "../shared/runtime-names.js";
import {
  decrypt,
  encrypt,
  type EncryptedBlob,
} from "../shared/crypto/index.js";

const SESSION_STORAGE_KEY = RUNTIME_NAMES.credentialPrefill;
const CREDENTIAL_PREFILL_AAD = "p2p-credential-prefill:username:v1";

interface StoredCredentialPrefill {
  version: 1;
  encryptedUsername: EncryptedBlob;
}

function isStoredCredentialPrefill(value: unknown): value is StoredCredentialPrefill {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredCredentialPrefill>;
  const encrypted = candidate.encryptedUsername;
  return (
    candidate.version === 1 &&
    typeof encrypted === "object" &&
    encrypted !== null &&
    typeof encrypted.iv === "string" &&
    encrypted.iv.length > 0 &&
    typeof encrypted.ciphertext === "string" &&
    encrypted.ciphertext.length > 0
  );
}

export async function saveCredentialPrefill(
  key: CryptoKey,
  username: string,
): Promise<void> {
  const encryptedUsername = await encrypt(key, username, CREDENTIAL_PREFILL_AAD);
  const stored: StoredCredentialPrefill = {
    version: 1,
    encryptedUsername,
  };
  await chrome.storage.session.set({ [SESSION_STORAGE_KEY]: stored });
}

export async function getCredentialPrefill(key: CryptoKey): Promise<string> {
  const result = await chrome.storage.session.get(SESSION_STORAGE_KEY);
  const stored = result[SESSION_STORAGE_KEY];
  if (stored === undefined) return "";
  if (!isStoredCredentialPrefill(stored)) {
    await clearCredentialPrefill();
    return "";
  }

  try {
    return await decrypt(key, stored.encryptedUsername, CREDENTIAL_PREFILL_AAD);
  } catch {
    await clearCredentialPrefill();
    return "";
  }
}

export async function clearCredentialPrefill(): Promise<void> {
  await chrome.storage.session.remove(SESSION_STORAGE_KEY);
}

export async function removeUnsafeCredentialPrefill(): Promise<void> {
  const result = await chrome.storage.session.get(SESSION_STORAGE_KEY);
  const stored = result[SESSION_STORAGE_KEY];
  if (stored === undefined || isStoredCredentialPrefill(stored)) return;
  await clearCredentialPrefill();
}

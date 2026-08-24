import type { PlatformId, StoredCredentials } from "../shared/types/index.js";

interface CredentialStorage {
  getCredentials: (
    platformId: PlatformId,
  ) => Promise<StoredCredentials | undefined>;
  saveCredentials: (credentials: StoredCredentials) => Promise<void>;
}

export function credentialReplacementLoginMetadata(
  existing: StoredCredentials | undefined,
): Pick<StoredCredentials, "consecutiveLoginFailureCount" | "lastLoginError"> {
  return {
    consecutiveLoginFailureCount: 0,
    ...(existing?.lastLoginError
      ? { lastLoginError: existing.lastLoginError }
      : {}),
  };
}

export function mergeLoginFailure(
  credentials: StoredCredentials,
  message: string,
  updatedAt: string,
): StoredCredentials {
  const consecutiveLoginFailureCount = Math.min(
    2,
    (credentials.consecutiveLoginFailureCount ?? 0) + 1,
  );
  const lastLoginError =
    message.trim().replace(/\s+/g, " ").slice(0, 500) || "Login failed";

  return {
    ...credentials,
    updatedAt,
    safeModeEnabled: true,
    consecutiveLoginFailureCount,
    lastLoginError,
    ...(consecutiveLoginFailureCount >= 2
      ? { stealthModeEnabled: true }
      : {}),
  };
}

export function mergeLoginSuccess(
  credentials: StoredCredentials,
  updatedAt: string,
): StoredCredentials {
  return {
    ...credentials,
    updatedAt,
    consecutiveLoginFailureCount: 0,
  };
}

export function mergeLoginSyncStarted(
  credentials: StoredCredentials,
  updatedAt: string,
): StoredCredentials {
  const updated = { ...credentials, updatedAt };
  delete updated.lastLoginError;
  return updated;
}

async function updateStoredCredentials(
  platformId: PlatformId,
  storage: CredentialStorage,
  merge: (credentials: StoredCredentials) => StoredCredentials,
): Promise<void> {
  const latest = await storage.getCredentials(platformId);
  if (!latest) return;
  await storage.saveCredentials(merge(latest));
}

export async function recordStoredLoginFailure(
  platformId: PlatformId,
  message: string,
  storage: CredentialStorage,
  updatedAt = new Date().toISOString(),
): Promise<void> {
  await updateStoredCredentials(platformId, storage, (credentials) =>
    mergeLoginFailure(credentials, message, updatedAt),
  );
}

export async function resetStoredLoginFailureCount(
  platformId: PlatformId,
  storage: CredentialStorage,
  updatedAt = new Date().toISOString(),
): Promise<void> {
  const latest = await storage.getCredentials(platformId);
  if (!latest || (latest.consecutiveLoginFailureCount ?? 0) === 0) return;
  await storage.saveCredentials(mergeLoginSuccess(latest, updatedAt));
}

export async function clearStoredLoginError(
  platformId: PlatformId,
  storage: CredentialStorage,
  updatedAt = new Date().toISOString(),
): Promise<void> {
  const latest = await storage.getCredentials(platformId);
  if (!latest?.lastLoginError) return;
  await storage.saveCredentials(mergeLoginSyncStarted(latest, updatedAt));
}

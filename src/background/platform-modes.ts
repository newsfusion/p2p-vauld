import type {
  PlatformId,
  PlatformModeOverrides,
  StoredCredentials,
} from "../shared/types/index.js";

export function mergeCredentialModeUpdate(
  credentials: StoredCredentials,
  config: PlatformModeOverrides,
  updatedAt: string,
): StoredCredentials {
  return {
    ...credentials,
    updatedAt,
    ...(config.safeModeEnabled === undefined
      ? {}
      : { safeModeEnabled: config.safeModeEnabled }),
    ...(config.stealthModeEnabled === undefined
      ? {}
      : { stealthModeEnabled: config.stealthModeEnabled }),
    ...(config.stealthModeEnabled === false
      ? { consecutiveLoginFailureCount: 0 }
      : {}),
  };
}

export async function updateStoredPlatformModes(
  platformId: PlatformId,
  config: PlatformModeOverrides,
  storage: {
    getCredentials: (platformId: PlatformId) => Promise<StoredCredentials | undefined>;
    saveCredentials: (credentials: StoredCredentials) => Promise<void>;
  },
  now = new Date().toISOString(),
): Promise<void> {
  const existing = await storage.getCredentials(platformId);
  if (!existing) {
    throw new Error("Credentials not found for platform");
  }

  await storage.saveCredentials(
    mergeCredentialModeUpdate(existing, config, now),
  );
}

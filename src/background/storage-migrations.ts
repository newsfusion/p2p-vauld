import { RUNTIME_NAMES } from "../shared/runtime-names.js";

export const STORAGE_SCHEMA_VERSION_KEY = RUNTIME_NAMES.storageSchemaVersion;
export const CURRENT_STORAGE_SCHEMA_VERSION = 1;

export interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface StorageMigration {
  toVersion: number;
  migrate: (storage: StorageAreaLike) => Promise<void>;
}

const storageMigrations: readonly StorageMigration[] = [
  {
    toVersion: 1,
    migrate: async () => {
      // Baseline schema marker for future upgrade-safe storage migrations.
    },
  },
];

function normalizeStoredVersion(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function getPendingMigrations(
  currentVersion: number,
  migrations: readonly StorageMigration[],
): StorageMigration[] {
  return [...migrations]
    .sort((left, right) => left.toVersion - right.toVersion)
    .filter(
      (migration) =>
        migration.toVersion > currentVersion &&
        migration.toVersion <= CURRENT_STORAGE_SCHEMA_VERSION,
    );
}

export async function runStorageMigrations(
  storage: StorageAreaLike = chrome.storage.local,
  migrations: readonly StorageMigration[] = storageMigrations,
): Promise<{
  fromVersion: number;
  toVersion: number;
  appliedVersions: number[];
}> {
  const stored = await storage.get(STORAGE_SCHEMA_VERSION_KEY);
  const fromVersion = normalizeStoredVersion(stored[STORAGE_SCHEMA_VERSION_KEY]);

  // Downgraded builds must not rewrite a newer on-disk schema marker.
  if (fromVersion > CURRENT_STORAGE_SCHEMA_VERSION) {
    return {
      fromVersion,
      toVersion: fromVersion,
      appliedVersions: [],
    };
  }

  const appliedVersions: number[] = [];
  let currentVersion = fromVersion;

  for (const migration of getPendingMigrations(fromVersion, migrations)) {
    await migration.migrate(storage);
    currentVersion = migration.toVersion;
    appliedVersions.push(currentVersion);
    await storage.set({ [STORAGE_SCHEMA_VERSION_KEY]: currentVersion });
  }

  return {
    fromVersion,
    toVersion: currentVersion,
    appliedVersions,
  };
}

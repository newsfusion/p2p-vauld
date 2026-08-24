import { describe, expect, it, vi } from "vitest";
import {
  CURRENT_STORAGE_SCHEMA_VERSION,
  STORAGE_SCHEMA_VERSION_KEY,
  runStorageMigrations,
  type StorageAreaLike,
  type StorageMigration,
} from "../../src/background/storage-migrations.js";

function createFakeStorage(
  initialState: Record<string, unknown> = {},
): StorageAreaLike & {
  state: Record<string, unknown>;
  setSpy: ReturnType<typeof vi.fn>;
} {
  const state = { ...initialState };
  const setSpy = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(state, items);
  });

  return {
    state,
    setSpy,
    get: async (keys) => {
      if (typeof keys === "string") {
        return { [keys]: state[keys] };
      }

      return Object.fromEntries(keys.map((key) => [key, state[key]]));
    },
    set: setSpy,
  };
}

describe("storage migrations", () => {
  it("bootstraps schema marker on first run", async () => {
    const storage = createFakeStorage();

    const result = await runStorageMigrations(storage);

    expect(result).toEqual({
      fromVersion: 0,
      toVersion: CURRENT_STORAGE_SCHEMA_VERSION,
      appliedVersions: [CURRENT_STORAGE_SCHEMA_VERSION],
    });
    expect(storage.state[STORAGE_SCHEMA_VERSION_KEY]).toBe(
      CURRENT_STORAGE_SCHEMA_VERSION,
    );
  });

  it("skips work when schema marker is already current", async () => {
    const storage = createFakeStorage({
      [STORAGE_SCHEMA_VERSION_KEY]: CURRENT_STORAGE_SCHEMA_VERSION,
    });

    const result = await runStorageMigrations(storage);

    expect(result).toEqual({
      fromVersion: CURRENT_STORAGE_SCHEMA_VERSION,
      toVersion: CURRENT_STORAGE_SCHEMA_VERSION,
      appliedVersions: [],
    });
    expect(storage.setSpy).not.toHaveBeenCalled();
  });

  it("applies custom migrations in ascending order", async () => {
    const storage = createFakeStorage();
    const applied: number[] = [];
    const migrations: readonly StorageMigration[] = [
      {
        toVersion: 1,
        migrate: async (target) => {
          applied.push(1);
          await target.set({ first: true });
        },
      },
      {
        toVersion: 2,
        migrate: async (target) => {
          applied.push(2);
          await target.set({ second: true });
        },
      },
    ];

    const result = await runStorageMigrations(storage, migrations);

    expect(result).toEqual({
      fromVersion: 0,
      toVersion: 1,
      appliedVersions: [1],
    });
    expect(applied).toEqual([1]);
    expect(storage.state.first).toBe(true);
    expect(storage.state.second).toBeUndefined();
  });

  it("does not rewrite newer schema marker on downgrade", async () => {
    const storage = createFakeStorage({
      [STORAGE_SCHEMA_VERSION_KEY]: CURRENT_STORAGE_SCHEMA_VERSION + 1,
    });

    const result = await runStorageMigrations(storage);

    expect(result).toEqual({
      fromVersion: CURRENT_STORAGE_SCHEMA_VERSION + 1,
      toVersion: CURRENT_STORAGE_SCHEMA_VERSION + 1,
      appliedVersions: [],
    });
    expect(storage.setSpy).not.toHaveBeenCalled();
  });
});

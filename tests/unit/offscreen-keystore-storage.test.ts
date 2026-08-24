import { afterEach, describe, expect, it, vi } from "vitest";

describe("offscreen keystore storage", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).indexedDB;
    vi.resetModules();
  });

  it("waits for the write transaction to commit before resolving", async () => {
    const writeRequest = {} as IDBRequest<IDBValidKey>;
    const transaction = {
      objectStore: vi.fn(() => ({ put: vi.fn(() => writeRequest) })),
    } as unknown as IDBTransaction;
    const db = {
      transaction: vi.fn(() => transaction),
      close: vi.fn(),
    } as unknown as IDBDatabase;
    const openRequest = { result: db } as IDBOpenDBRequest;
    (globalThis as Record<string, unknown>).indexedDB = {
      open: vi.fn(() => openRequest),
    };

    const { setStoredInvisibleKey } = await import(
      "../../src/offscreen/keystore-storage.js"
    );
    let settled = false;
    const write = setStoredInvisibleKey("key-b64").then(() => {
      settled = true;
    });

    openRequest.onsuccess?.(new Event("success"));
    await Promise.resolve();
    await Promise.resolve();
    expect(writeRequest.onsuccess).toBeTypeOf("function");
    writeRequest.onsuccess?.(new Event("success"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);

    transaction.oncomplete?.(new Event("complete"));
    await write;
    expect(settled).toBe(true);
  });
});

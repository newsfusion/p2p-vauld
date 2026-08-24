import { RUNTIME_NAMES } from "../shared/runtime-names.js";

export const KEYSTORE_DB_NAME = RUNTIME_NAMES.keystoreDatabase;
const KEYSTORE_DB_VERSION = 1;
const KEYSTORE_STORE = "keys";
const INVISIBLE_KEY_ID = "invisible_key";

interface KeyRecord {
  id: string;
  value: string;
}

function openKeystoreDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEYSTORE_DB_NAME, KEYSTORE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEYSTORE_STORE)) {
        db.createObjectStore(KEYSTORE_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open keystore"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openKeystoreDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEYSTORE_STORE, mode);
    const request = operation(tx.objectStore(KEYSTORE_STORE));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error ?? new Error("Keystore request failed"));
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("Keystore transaction aborted"));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Keystore transaction failed"));
    };
  });
}

export async function getStoredInvisibleKey(): Promise<string | undefined> {
  const record = await withStore<KeyRecord | undefined>("readonly", (store) =>
    store.get(INVISIBLE_KEY_ID),
  );
  return record?.value;
}

export async function setStoredInvisibleKey(keyBase64: string): Promise<void> {
  await withStore<IDBValidKey>("readwrite", (store) =>
    store.put({ id: INVISIBLE_KEY_ID, value: keyBase64 }),
  );
}

export async function deleteStoredInvisibleKey(): Promise<void> {
  await withStore<undefined>("readwrite", (store) =>
    store.delete(INVISIBLE_KEY_ID),
  );
}

export async function hasStoredInvisibleKey(): Promise<boolean> {
  return (await getStoredInvisibleKey()) !== undefined;
}

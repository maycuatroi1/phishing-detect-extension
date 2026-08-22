export const BLOCKLIST_DB_NAME = "anti-fraud-blocklist";

export const BLOCKLIST_DB_VERSION = 1;

export const BLOCKLIST_STORE_NAME = "artifact";

export const BLOCKLIST_RECORD_KEY = "current";

export interface StoredBlocklist {
  readonly key: string;
  readonly format: number;
  readonly version: number;
  readonly phish: BigUint64Array;
  readonly legit: BigUint64Array;
  readonly soft: BigUint64Array;
  readonly etag: string | null;
  readonly pinnedUrl: string | null;
  readonly fetchedAt: number;
}

function openBlocklistDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BLOCKLIST_DB_NAME, BLOCKLIST_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BLOCKLIST_STORE_NAME)) {
        db.createObjectStore(BLOCKLIST_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB.open thất bại"));
    request.onblocked = () => reject(new Error("indexedDB.open bị chặn bởi một kết nối cũ"));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openBlocklistDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(BLOCKLIST_STORE_NAME, mode);
        const request = work(transaction.objectStore(BLOCKLIST_STORE_NAME));
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("transaction IndexedDB thất bại"));
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error ?? new Error("transaction IndexedDB bị huỷ"));
        };
      }),
  );
}

export function withSoftArray(record: StoredBlocklist): StoredBlocklist {
  return record.soft instanceof BigUint64Array
    ? record
    : { ...record, soft: new BigUint64Array(0) };
}

export async function readStoredBlocklist(): Promise<StoredBlocklist | null> {
  const record = await runTransaction<StoredBlocklist | undefined>("readonly", (store) =>
    store.get(BLOCKLIST_RECORD_KEY),
  );
  return record === undefined ? null : withSoftArray(record);
}

export async function writeStoredBlocklist(record: Omit<StoredBlocklist, "key">): Promise<void> {
  await runTransaction("readwrite", (store) =>
    store.put({ ...record, key: BLOCKLIST_RECORD_KEY }),
  );
}

export async function clearStoredBlocklist(): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(BLOCKLIST_RECORD_KEY));
}

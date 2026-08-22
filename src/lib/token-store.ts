import { isInstallToken } from "./install.ts";

export const INSTALL_DB_NAME = "anti-fraud-install";

export const INSTALL_DB_VERSION = 1;

export const INSTALL_STORE_NAME = "token";

export const INSTALL_RECORD_KEY = "current";

export const DAY_MS = 86_400_000;

export interface StoredInstallToken {
  readonly key: string;
  readonly token: string;
  readonly rotateAfterDays: number;
  readonly mintedAt: number;
}

function openInstallDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INSTALL_DB_NAME, INSTALL_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(INSTALL_STORE_NAME)) {
        db.createObjectStore(INSTALL_STORE_NAME, { keyPath: "key" });
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
  return openInstallDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(INSTALL_STORE_NAME, mode);
        const request = work(transaction.objectStore(INSTALL_STORE_NAME));
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

function isStoredInstallToken(value: unknown): value is StoredInstallToken {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isInstallToken(record.token) &&
    typeof record.rotateAfterDays === "number" &&
    Number.isInteger(record.rotateAfterDays) &&
    record.rotateAfterDays >= 1 &&
    typeof record.mintedAt === "number" &&
    Number.isFinite(record.mintedAt)
  );
}

export async function readStoredInstallToken(): Promise<StoredInstallToken | null> {
  const record = await runTransaction<unknown>("readonly", (store) =>
    store.get(INSTALL_RECORD_KEY),
  );
  return isStoredInstallToken(record) ? record : null;
}

export async function writeStoredInstallToken(
  record: Omit<StoredInstallToken, "key">,
): Promise<void> {
  await runTransaction("readwrite", (store) => store.put({ ...record, key: INSTALL_RECORD_KEY }));
}

export async function clearStoredInstallToken(): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(INSTALL_RECORD_KEY));
}

export function isTokenPastRotation(record: StoredInstallToken, now: number): boolean {
  return now - record.mintedAt >= record.rotateAfterDays * DAY_MS;
}

export const DISMISSAL_DB_NAME = "anti-fraud-dismissals";

export const DISMISSAL_DB_VERSION = 1;

export const DISMISSAL_STORE_NAME = "dismissal";

export interface StoredDismissal {
  readonly host: string;
  readonly dismissedAt: number;
}

function openDismissalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DISMISSAL_DB_NAME, DISMISSAL_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DISMISSAL_STORE_NAME)) {
        db.createObjectStore(DISMISSAL_STORE_NAME, { keyPath: "host" });
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
  return openDismissalDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(DISMISSAL_STORE_NAME, mode);
        const request = work(transaction.objectStore(DISMISSAL_STORE_NAME));
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

export function isStoredDismissal(value: unknown): value is StoredDismissal {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.host === "string" &&
    record.host.length > 0 &&
    typeof record.dismissedAt === "number" &&
    Number.isFinite(record.dismissedAt)
  );
}

export function silencesWarning(dismissal: StoredDismissal | null): boolean {
  return dismissal !== null;
}

export async function readDismissal(host: string): Promise<StoredDismissal | null> {
  const record = await runTransaction<unknown>("readonly", (store) => store.get(host));
  return isStoredDismissal(record) ? record : null;
}

export async function writeDismissal(record: StoredDismissal): Promise<void> {
  await runTransaction("readwrite", (store) => store.put(record));
}

export async function clearDismissal(host: string): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(host));
}

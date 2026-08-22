import { SOFTENING_CLAIM, isReportClaim, type ReportClaim } from "./claim.ts";

export const DISPUTE_DB_NAME = "anti-fraud-disputes";

export const DISPUTE_DB_VERSION = 1;

export const DISPUTE_STORE_NAME = "dispute";

export interface StoredDispute {
  readonly host: string;
  readonly claim: ReportClaim;
  readonly reportId: string;
  readonly filedAt: number;
}

function openDisputeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DISPUTE_DB_NAME, DISPUTE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DISPUTE_STORE_NAME)) {
        db.createObjectStore(DISPUTE_STORE_NAME, { keyPath: "host" });
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
  return openDisputeDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(DISPUTE_STORE_NAME, mode);
        const request = work(transaction.objectStore(DISPUTE_STORE_NAME));
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

export function isStoredDispute(value: unknown): value is StoredDispute {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.host === "string" &&
    record.host.length > 0 &&
    isReportClaim(record.claim) &&
    typeof record.reportId === "string" &&
    record.reportId.length > 0 &&
    typeof record.filedAt === "number" &&
    Number.isFinite(record.filedAt)
  );
}

export function softensWarning(dispute: StoredDispute | null): boolean {
  return dispute !== null && dispute.claim === SOFTENING_CLAIM;
}

export async function readDispute(host: string): Promise<StoredDispute | null> {
  const record = await runTransaction<unknown>("readonly", (store) => store.get(host));
  return isStoredDispute(record) ? record : null;
}

export async function writeDispute(record: StoredDispute): Promise<void> {
  await runTransaction("readwrite", (store) => store.put(record));
}

export async function clearDispute(host: string): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(host));
}

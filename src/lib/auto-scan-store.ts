export const AUTO_SCAN_DB_NAME = "anti-fraud-auto-scan";

export const AUTO_SCAN_DB_VERSION = 1;

export const AUTO_SCAN_SETTINGS_STORE = "settings";

export const AUTO_SCAN_LEDGER_STORE = "ledger";

export const AUTO_SCAN_SETTINGS_KEY = "current";

export const AUTO_SCAN_DEFAULT_ENABLED = true;

export interface AutoScanSettings {
  readonly key: string;
  readonly enabled: boolean;
  readonly changedAt: number;
}

export interface AutoScanEntry {
  readonly host: string;
  readonly scannedAt: number;
  readonly score: number;
  readonly isScam: boolean | null;
}

export interface AutoScanDay {
  readonly day: string;
  readonly entries: readonly AutoScanEntry[];
}

export function dayKeyOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function openAutoScanDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUTO_SCAN_DB_NAME, AUTO_SCAN_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUTO_SCAN_SETTINGS_STORE)) {
        db.createObjectStore(AUTO_SCAN_SETTINGS_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(AUTO_SCAN_LEDGER_STORE)) {
        db.createObjectStore(AUTO_SCAN_LEDGER_STORE, { keyPath: "day" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB.open thất bại"));
    request.onblocked = () => reject(new Error("indexedDB.open bị chặn bởi một kết nối cũ"));
  });
}

function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openAutoScanDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = work(transaction.objectStore(storeName));
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

export function isAutoScanEntry(value: unknown): value is AutoScanEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.host === "string" &&
    record.host.length > 0 &&
    typeof record.scannedAt === "number" &&
    Number.isFinite(record.scannedAt) &&
    typeof record.score === "number" &&
    Number.isFinite(record.score) &&
    (record.isScam === null || typeof record.isScam === "boolean")
  );
}

export function isAutoScanDay(value: unknown): value is AutoScanDay {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.day === "string" &&
    record.day.length > 0 &&
    Array.isArray(record.entries) &&
    record.entries.every(isAutoScanEntry)
  );
}

export async function readAutoScanEnabled(): Promise<boolean> {
  const record = await runTransaction<unknown>(AUTO_SCAN_SETTINGS_STORE, "readonly", (store) =>
    store.get(AUTO_SCAN_SETTINGS_KEY),
  );
  if (typeof record !== "object" || record === null) {
    return AUTO_SCAN_DEFAULT_ENABLED;
  }
  const enabled = (record as Record<string, unknown>).enabled;
  return typeof enabled === "boolean" ? enabled : AUTO_SCAN_DEFAULT_ENABLED;
}

export async function writeAutoScanEnabled(enabled: boolean, changedAt: number): Promise<void> {
  await runTransaction(AUTO_SCAN_SETTINGS_STORE, "readwrite", (store) =>
    store.put({ key: AUTO_SCAN_SETTINGS_KEY, enabled, changedAt }),
  );
}

export async function readAutoScanDay(day: string): Promise<AutoScanDay> {
  const record = await runTransaction<unknown>(AUTO_SCAN_LEDGER_STORE, "readonly", (store) =>
    store.get(day),
  );
  return isAutoScanDay(record) ? record : { day, entries: [] };
}

export async function reserveAutoScanSlot(day: string, entry: AutoScanEntry): Promise<AutoScanDay> {
  const current = await readAutoScanDay(day);
  const next: AutoScanDay = { day, entries: [...current.entries, entry] };
  await runTransaction(AUTO_SCAN_LEDGER_STORE, "readwrite", (store) => store.put(next));
  return next;
}

export async function settleAutoScanSlot(
  day: string,
  host: string,
  isScam: boolean | null,
): Promise<void> {
  const current = await readAutoScanDay(day);
  const next: AutoScanDay = {
    day,
    entries: current.entries.map((entry) => (entry.host === host ? { ...entry, isScam } : entry)),
  };
  await runTransaction(AUTO_SCAN_LEDGER_STORE, "readwrite", (store) => store.put(next));
}

export async function pruneAutoScanDaysBefore(day: string): Promise<void> {
  const keys = await runTransaction<IDBValidKey[]>(AUTO_SCAN_LEDGER_STORE, "readonly", (store) =>
    store.getAllKeys(),
  );
  for (const key of keys) {
    if (typeof key === "string" && key !== day) {
      await runTransaction(AUTO_SCAN_LEDGER_STORE, "readwrite", (store) => store.delete(key));
    }
  }
}

export async function clearAutoScanStore(): Promise<void> {
  await runTransaction(AUTO_SCAN_SETTINGS_STORE, "readwrite", (store) => store.clear());
  await runTransaction(AUTO_SCAN_LEDGER_STORE, "readwrite", (store) => store.clear());
}

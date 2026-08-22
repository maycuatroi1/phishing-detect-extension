import { readDismissal, silencesWarning } from "../lib/dismissal-store.ts";
import { toastFor, type ToastNotice } from "../lib/toast.ts";
import type { AutoScanOutcome } from "../lib/auto-scan.ts";

const ICON_URL = "icons/icon128.png";

export async function hostIsSilenced(host: string): Promise<boolean> {
  try {
    return silencesWarning(await readDismissal(host));
  } catch {
    return false;
  }
}

export async function showToast(notice: ToastNotice): Promise<void> {
  if (typeof chrome.notifications === "undefined") {
    return;
  }

  await chrome.notifications.create(notice.id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL(ICON_URL),
    title: notice.title,
    message: notice.message,
    priority: notice.tone === "scam" ? 2 : 0,
    requireInteraction: false,
  });

  setTimeout(() => {
    void chrome.notifications.clear(notice.id);
  }, notice.timeoutMs);
}

export async function announceAutoScan(host: string, outcome: AutoScanOutcome): Promise<void> {
  const notice = toastFor(host, outcome);
  if (notice === null) {
    return;
  }

  if (notice.tone === "scam" && (await hostIsSilenced(host))) {
    return;
  }

  try {
    await showToast(notice);
  } catch (cause) {
    console.warn("[toast] không hiện được thông báo:", String(cause));
  }
}

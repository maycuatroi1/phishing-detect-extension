import { API_BASE_URL, IMPLEMENTED_TIERS } from "../config.ts";
import { blocklistAgeMs } from "../lib/blocklist-sync.ts";
import { readStoredBlocklist } from "../lib/blocklist-store.ts";

function slot(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-slot='${name}']`);
}

function setSlot(name: string, value: string): void {
  const element = slot(name);
  if (element !== null) {
    element.textContent = value;
  }
}

function formatAge(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) {
    return `${Math.floor(ms / 60_000)} phút trước`;
  }
  if (hours < 48) {
    return `${hours} giờ trước`;
  }
  return `${Math.floor(hours / 24)} ngày trước`;
}

setSlot("api-base-url", API_BASE_URL);
setSlot("tiers", IMPLEMENTED_TIERS.length === 0 ? "Chưa có tier nào được bật" : IMPLEMENTED_TIERS.join(", "));

readStoredBlocklist()
  .then((record) => {
    if (record === null) {
      setSlot("artifact-version", "chưa tải");
      setSlot("artifact-entries", "-");
      setSlot("artifact-age", "-");
      return;
    }
    setSlot("artifact-version", `${record.version} (format ${record.format})`);
    setSlot("artifact-entries", `${record.phish.length} phish, ${record.legit.length} legit`);
    setSlot("artifact-age", formatAge(blocklistAgeMs(record, Date.now())));
  })
  .catch(() => {
    setSlot("artifact-version", "không đọc được kho cục bộ");
  });

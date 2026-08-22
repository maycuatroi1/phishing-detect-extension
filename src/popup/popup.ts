import { API_BASE_URL, IMPLEMENTED_TIERS } from "../config.ts";
import { blocklistAgeMs } from "../lib/blocklist-sync.ts";
import { readStoredBlocklist } from "../lib/blocklist-store.ts";
import { isScannableUrl } from "../lib/scan.ts";
import { runManualScan } from "../lib/tier2.ts";
import { panelView, type PanelModel, type PanelView } from "./scan-panel.ts";

function slot(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-slot='${name}']`);
}

function setSlot(name: string, value: string): void {
  const element = slot(name);
  if (element !== null) {
    element.textContent = value;
  }
}

function scanButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>("[data-action='scan']");
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

function render(view: PanelView): void {
  setSlot("scan-headline", view.headline);
  setSlot("scan-detail", view.detail);
  const button = scanButton();
  if (button !== null) {
    button.disabled = !view.scanEnabled;
    button.textContent = view.buttonLabel;
  }
}

async function activeTabUrl(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url;
  return typeof url === "string" && isScannableUrl(url) ? url : null;
}

function apply(model: PanelModel): void {
  render(panelView(model));
}

async function start(): Promise<void> {
  let url: string | null = null;
  try {
    url = await activeTabUrl();
  } catch {
    url = null;
  }

  apply({ kind: "idle", url });

  const button = scanButton();
  if (button === null || url === null) {
    return;
  }

  let running = false;

  button.addEventListener("click", () => {
    if (running) {
      return;
    }
    running = true;
    apply({ kind: "scanning", url });

    void runManualScan({ baseUrl: API_BASE_URL }, url)
      .then((outcome) => {
        apply({ kind: "result", url, outcome });
      })
      .catch((cause: unknown) => {
        apply({
          kind: "result",
          url,
          outcome: { kind: "unavailable", reason: `lần quét ném lỗi: ${String(cause)}` },
        });
      })
      .finally(() => {
        running = false;
      });
  });
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

void start();

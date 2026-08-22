import { API_BASE_URL, IMPLEMENTED_TIERS } from "../config.ts";
import { blocklistAgeMs } from "../lib/blocklist-sync.ts";
import { readStoredBlocklist } from "../lib/blocklist-store.ts";
import { REPORT_CLAIMS, type ReportClaim } from "../lib/claim.ts";
import { readDispute, type StoredDispute } from "../lib/dispute-store.ts";
import { hostOfUrl } from "../lib/host.ts";
import { isScannableUrl } from "../lib/scan.ts";
import { lookupHost, type Tier0Verdict } from "../lib/tier0.ts";
import { runManualScan } from "../lib/tier2.ts";
import { fileReport } from "../lib/tier3.ts";
import { panelView, type PanelModel, type PanelView } from "./scan-panel.ts";
import { reportPanelView, type ReportModel, type ReportPanelView } from "./report-panel.ts";

const REPORT_ACTIONS: Record<ReportClaim, string> = {
  phishing: "report-phishing",
  false_positive: "report-false-positive",
};

function slot(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-slot='${name}']`);
}

function setSlot(name: string, value: string): void {
  const element = slot(name);
  if (element !== null) {
    element.textContent = value;
  }
}

function actionButton(action: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[data-action='${action}']`);
}

function dressButton(action: string, label: string, enabled: boolean): void {
  const button = actionButton(action);
  if (button !== null) {
    button.disabled = !enabled;
    button.textContent = label;
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

function render(view: PanelView): void {
  setSlot("scan-headline", view.headline);
  setSlot("scan-detail", view.detail);
  dressButton("scan", view.buttonLabel, view.scanEnabled);
}

function renderReport(view: ReportPanelView): void {
  setSlot("report-headline", view.headline);
  setSlot("report-detail", view.detail);
  dressButton(REPORT_ACTIONS.phishing, view.phishingLabel, view.phishingEnabled);
  dressButton(REPORT_ACTIONS.false_positive, view.falsePositiveLabel, view.falsePositiveEnabled);
}

async function activeTabUrl(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url;
  return typeof url === "string" && isScannableUrl(url) ? url : null;
}

function apply(model: PanelModel): void {
  render(panelView(model));
}

function applyReport(model: ReportModel): void {
  renderReport(reportPanelView(model));
}

function startScan(url: string | null): void {
  apply({ kind: "idle", url });

  const button = actionButton("scan");
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

async function currentDispute(host: string): Promise<StoredDispute | null> {
  try {
    return await readDispute(host);
  } catch {
    return null;
  }
}

async function currentVerdict(host: string): Promise<Tier0Verdict> {
  try {
    return (await lookupHost(host)).verdict;
  } catch {
    return "no_artifact";
  }
}

async function startReport(url: string | null): Promise<void> {
  const host = url === null ? null : hostOfUrl(url);
  if (url === null || host === null) {
    applyReport({ kind: "unsupported" });
    return;
  }

  let dispute = await currentDispute(host);
  applyReport({ kind: "ready", verdict: await currentVerdict(host), dispute });

  let filing = false;

  for (const claim of REPORT_CLAIMS) {
    const button = actionButton(REPORT_ACTIONS[claim]);
    if (button === null) {
      continue;
    }

    button.addEventListener("click", () => {
      if (filing) {
        return;
      }
      filing = true;
      applyReport({ kind: "filing", claim });

      void fileReport({ baseUrl: API_BASE_URL }, { url, claim })
        .then(async (outcome) => {
          dispute = await currentDispute(host);
          applyReport({ kind: "filed", outcome, dispute });
        })
        .catch((cause: unknown) => {
          applyReport({
            kind: "filed",
            outcome: { kind: "unavailable", reason: `lần gửi report ném lỗi: ${String(cause)}` },
            dispute,
          });
        })
        .finally(() => {
          filing = false;
        });
    });
  }
}

async function boot(): Promise<void> {
  let url: string | null = null;
  try {
    url = await activeTabUrl();
  } catch {
    url = null;
  }

  startScan(url);
  await startReport(url);
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

void boot();

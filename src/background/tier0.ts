import { API_BASE_URL } from "../config.ts";
import { BLOCKLIST_REFRESH_PERIOD_MINUTES, syncBlocklist } from "../lib/blocklist-sync.ts";
import { readDispute, softensWarning } from "../lib/dispute-store.ts";
import { hostOfUrl } from "../lib/host.ts";
import { invalidateTier0Cache, lookupHost, type Tier0Verdict } from "../lib/tier0.ts";

export const BLOCKLIST_ALARM_NAME = "blocklist-refresh";

export const HARD_WARNING_TEXT = "!";

export const REPORT_HINT = "Nếu đây là cảnh báo nhầm, mở popup và bấm Báo cảnh báo nhầm, đúng một cú bấm.";

export interface BadgeLook {
  readonly text: string;
  readonly color: string;
  readonly title: string;
}

export const DISPUTED_LOOK: BadgeLook = {
  text: "?",
  color: "#8d6e00",
  title:
    "Anti-Fraud: bạn đã báo trang này bị cảnh báo nhầm, nên cảnh báo đang ở mức mềm trong lúc chờ moderator xem lại",
};

const BADGE_BY_VERDICT: Record<Tier0Verdict, BadgeLook> = {
  phishing: {
    text: HARD_WARNING_TEXT,
    color: "#c62828",
    title: `Anti-Fraud: trang này nằm trong danh sách lừa đảo đã xác nhận. ${REPORT_HINT}`,
  },
  legit: {
    text: "OK",
    color: "#2e7d32",
    title: "Anti-Fraud: trang này nằm trong danh sách hợp lệ đã xác nhận",
  },
  unknown: {
    text: "",
    color: "#5a616e",
    title: "Anti-Fraud: chưa có kết luận cho trang này",
  },
  no_artifact: {
    text: "",
    color: "#5a616e",
    title: "Anti-Fraud: chưa tải được danh sách, chưa kết luận được",
  },
};

export function badgeLookFor(verdict: Tier0Verdict): BadgeLook {
  return BADGE_BY_VERDICT[verdict];
}

export async function paintLook(tabId: number, look: BadgeLook): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text: look.text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: look.color });
  await chrome.action.setTitle({ tabId, title: look.title });
}

export async function softenIfDisputed(host: string, look: BadgeLook): Promise<BadgeLook> {
  if (look.text !== HARD_WARNING_TEXT) {
    return look;
  }

  try {
    return softensWarning(await readDispute(host)) ? DISPUTED_LOOK : look;
  } catch {
    return look;
  }
}

export async function paintBadge(tabId: number, verdict: Tier0Verdict): Promise<void> {
  await paintLook(tabId, badgeLookFor(verdict));
}

export async function evaluateTab(tabId: number, url: string | undefined): Promise<Tier0Verdict> {
  const host = hostOfUrl(url);
  if (host === null) {
    await paintBadge(tabId, "unknown");
    return "unknown";
  }

  const result = await lookupHost(host);
  await paintLook(tabId, await softenIfDisputed(host, badgeLookFor(result.verdict)));
  return result.verdict;
}

export async function refreshBlocklist(): Promise<void> {
  const outcome = await syncBlocklist({ baseUrl: API_BASE_URL });

  if (outcome.kind === "fresh") {
    invalidateTier0Cache();
    console.info(
      "[tier0] artifact mới, version",
      outcome.version,
      "phish",
      outcome.phishCount,
      "legit",
      outcome.legitCount,
    );
    return;
  }

  if (outcome.kind === "unchanged") {
    console.info("[tier0] artifact không đổi, vẫn version", outcome.version);
    return;
  }

  if (outcome.kind === "refused") {
    console.warn(
      "[tier0] từ chối artifact:",
      outcome.refusal.code,
      outcome.refusal.message,
      "giữ version",
      outcome.keptVersion,
    );
    return;
  }

  if (outcome.kind === "rejected_older") {
    console.warn(
      "[tier0] artifact nhận được có version",
      outcome.incomingVersion,
      "cũ hơn version đang giữ",
      outcome.keptVersion,
      "nên bị bỏ qua",
    );
    return;
  }

  console.warn("[tier0] không lấy được artifact:", outcome.reason, "giữ version", outcome.keptVersion);
}

export type TabEvaluator = (tabId: number, url: string | undefined) => Promise<unknown>;

export function registerTier0(evaluate: TabEvaluator = evaluateTab): void {
  chrome.alarms.create(BLOCKLIST_ALARM_NAME, {
    periodInMinutes: BLOCKLIST_REFRESH_PERIOD_MINUTES,
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BLOCKLIST_ALARM_NAME) {
      void refreshBlocklist();
    }
  });

  chrome.runtime.onInstalled.addListener(() => {
    void refreshBlocklist();
  });

  chrome.runtime.onStartup.addListener(() => {
    void refreshBlocklist();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url === undefined && changeInfo.status !== "loading") {
      return;
    }
    void evaluate(tabId, changeInfo.url ?? tab.url);
  });

  chrome.tabs.onActivated.addListener((info) => {
    void chrome.tabs.get(info.tabId).then((tab) => evaluate(info.tabId, tab.url));
  });
}

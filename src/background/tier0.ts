import { API_BASE_URL } from "../config.ts";
import { BLOCKLIST_REFRESH_PERIOD_MINUTES, syncBlocklist } from "../lib/blocklist-sync.ts";
import { hostOfUrl } from "../lib/host.ts";
import { invalidateTier0Cache, lookupHost, type Tier0Verdict } from "../lib/tier0.ts";

export const BLOCKLIST_ALARM_NAME = "blocklist-refresh";

interface BadgeLook {
  readonly text: string;
  readonly color: string;
  readonly title: string;
}

const BADGE_BY_VERDICT: Record<Tier0Verdict, BadgeLook> = {
  phishing: {
    text: "!",
    color: "#c62828",
    title: "Anti-Fraud: trang này nằm trong danh sách lừa đảo đã xác nhận",
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

export async function paintBadge(tabId: number, verdict: Tier0Verdict): Promise<void> {
  const look = badgeLookFor(verdict);
  await chrome.action.setBadgeText({ tabId, text: look.text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: look.color });
  await chrome.action.setTitle({ tabId, title: look.title });
}

export async function evaluateTab(tabId: number, url: string | undefined): Promise<Tier0Verdict> {
  const host = hostOfUrl(url);
  if (host === null) {
    await paintBadge(tabId, "unknown");
    return "unknown";
  }

  const result = await lookupHost(host);
  await paintBadge(tabId, result.verdict);
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

export function registerTier0(): void {
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
    void evaluateTab(tabId, changeInfo.url ?? tab.url);
  });

  chrome.tabs.onActivated.addListener((info) => {
    void chrome.tabs.get(info.tabId).then((tab) => evaluateTab(info.tabId, tab.url));
  });
}

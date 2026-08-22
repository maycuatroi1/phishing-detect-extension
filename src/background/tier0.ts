import { API_BASE_URL } from "../config.ts";
import {
  DISMISSED_LOOK,
  DISPUTED_LOOK,
  badgeLookFor,
  type BadgeLook,
} from "../lib/badge.ts";
import { BLOCKLIST_REFRESH_PERIOD_MINUTES, syncBlocklist } from "../lib/blocklist-sync.ts";
import { readDismissal, silencesWarning } from "../lib/dismissal-store.ts";
import { readDispute, softensWarning } from "../lib/dispute-store.ts";
import { hostOfUrl } from "../lib/host.ts";
import { invalidateTier0Cache, lookupHost, type Tier0Verdict } from "../lib/tier0.ts";

export * from "../lib/badge.ts";

export const BLOCKLIST_ALARM_NAME = "blocklist-refresh";

export async function paintLook(tabId: number, look: BadgeLook): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text: look.text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: look.color });
  await chrome.action.setTitle({ tabId, title: look.title });
}

export function isServerWarningLook(look: BadgeLook): boolean {
  return look.state === "phishing" || look.state === "soft";
}

export async function softenIfDisputed(host: string, look: BadgeLook): Promise<BadgeLook> {
  if (!isServerWarningLook(look)) {
    return look;
  }

  try {
    return softensWarning(await readDispute(host)) ? DISPUTED_LOOK : look;
  } catch {
    return look;
  }
}

export function isWarningLook(look: BadgeLook): boolean {
  return isServerWarningLook(look) || look.state === DISPUTED_LOOK.state;
}

export async function quietIfDismissed(host: string, look: BadgeLook): Promise<BadgeLook> {
  if (!isWarningLook(look)) {
    return look;
  }

  try {
    return silencesWarning(await readDismissal(host)) ? DISMISSED_LOOK : look;
  } catch {
    return look;
  }
}

export async function userAdjustedLook(host: string, look: BadgeLook): Promise<BadgeLook> {
  return quietIfDismissed(host, await softenIfDisputed(host, look));
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
  await paintLook(tabId, await userAdjustedLook(host, badgeLookFor(result.verdict)));
  return result.verdict;
}

export async function refreshBlocklist(): Promise<void> {
  const outcome = await syncBlocklist({ baseUrl: API_BASE_URL });

  if (outcome.kind === "fresh") {
    invalidateTier0Cache();
    console.info(
      "[tier0] artifact mới, format",
      outcome.format,
      "version",
      outcome.version,
      "phish",
      outcome.phishCount,
      "legit",
      outcome.legitCount,
      "soft",
      outcome.softCount,
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

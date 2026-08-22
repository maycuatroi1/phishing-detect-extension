import { API_BASE_URL } from "../config.ts";
import { BLOCKLIST_REFRESH_PERIOD_MINUTES, syncBlocklist } from "../lib/blocklist-sync.ts";
import { readDismissal, silencesWarning } from "../lib/dismissal-store.ts";
import { readDispute, softensWarning } from "../lib/dispute-store.ts";
import { hostOfUrl } from "../lib/host.ts";
import { invalidateTier0Cache, lookupHost, type Tier0Verdict } from "../lib/tier0.ts";

export const BLOCKLIST_ALARM_NAME = "blocklist-refresh";

export const HARD_WARNING_TEXT = "!";

export const SOFT_WARNING_TEXT = "~";

export const MACHINE_UNVERIFIED_TEXT =
  "Trang này bị máy đánh dấu, chưa có người kiểm chứng.";

export const REPORT_HINT = "Nếu đây là cảnh báo nhầm, mở popup và bấm Báo cảnh báo nhầm, đúng một cú bấm.";

export const SOFT_REPORT_HINT =
  "Với cảnh báo do máy dựng, đúng một lượt Báo cảnh báo nhầm trong popup gỡ nó cho mọi người ngay, không cần moderator.";

export const DISMISS_HINT = "Trang vẫn mở bình thường, extension không chặn và không chuyển hướng. Muốn im hẳn thì mở popup và bấm Tắt cảnh báo cho trang này.";

export interface BadgeLook {
  readonly text: string;
  readonly color: string;
  readonly title: string;
}

export const DISPUTED_LOOK: BadgeLook = {
  text: "?",
  color: "#8d6e00",
  title:
    "Anti-Fraud: bạn đã báo trang này bị cảnh báo nhầm, nên extension đã hạ cảnh báo xuống mức mềm trên máy bạn. Cảnh báo do máy dựng thì một lượt báo nhầm gỡ luôn cho mọi người; cảnh báo do người xác nhận thì phải chờ moderator xem lại.",
};

export const DISMISSED_LOOK: BadgeLook = {
  text: "",
  color: "#5a616e",
  title:
    "Anti-Fraud: bạn đã tắt cảnh báo cho trang này. Mở popup rồi bấm Bật lại cảnh báo nếu muốn nó quay lại, cũng đúng một cú bấm.",
};

const BADGE_BY_VERDICT: Record<Tier0Verdict, BadgeLook> = {
  phishing: {
    text: HARD_WARNING_TEXT,
    color: "#c62828",
    title: `Anti-Fraud: trang này nằm trong danh sách lừa đảo đã xác nhận, tức là một người đã xem và kết luận. ${REPORT_HINT} ${DISMISS_HINT}`,
  },
  soft: {
    text: SOFT_WARNING_TEXT,
    color: "#ef6c00",
    title: `Anti-Fraud: ${MACHINE_UNVERIFIED_TEXT} Nó khác hẳn mức đỏ, nơi đã có một người xem và kết luận, và nó sai khoảng 3 lần trên 100. ${SOFT_REPORT_HINT} ${DISMISS_HINT}`,
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

export function isServerWarningLook(look: BadgeLook): boolean {
  return look.text === HARD_WARNING_TEXT || look.text === SOFT_WARNING_TEXT;
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
  return isServerWarningLook(look) || look.text === DISPUTED_LOOK.text;
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

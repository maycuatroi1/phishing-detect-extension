import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISMISSED_LOOK,
  DISPUTED_LOOK,
  NG_TEXT,
  OK_TEXT,
  badgeLookFor,
  evaluateTab,
  isWarningLook,
  lookForLevel,
  userAdjustedLook,
} from "../src/background/tier0.ts";
import { AUTO_SCAN_WARNING_LOOK, knownVerdictOf } from "../src/background/auto-scan.ts";
import {
  AFBL_FORMAT,
  AFBL_HEADER_BYTES,
  AFBL_PREFERRED_FORMAT,
  AFBL_SOFT_COUNT_OFFSET,
  AFBL_SOFT_FORMAT,
  AFBL_SOFT_HEADER_BYTES,
  afblByteLength,
  afblContains,
  decodeAfbl,
  encodeAfbl,
} from "../src/lib/afbl.ts";
import { decideAutoScan } from "../src/lib/auto-scan.ts";
import { clearStoredBlocklist, readStoredBlocklist } from "../src/lib/blocklist-store.ts";
import { syncBlocklist } from "../src/lib/blocklist-sync.ts";
import { clearDismissal, writeDismissal, type StoredDismissal } from "../src/lib/dismissal-store.ts";
import { clearDispute, writeDispute, type StoredDispute } from "../src/lib/dispute-store.ts";
import { hostEntryOf } from "../src/lib/host.ts";
import { scoreHost } from "../src/lib/risk.ts";
import { invalidateTier0Cache, lookupHost, type Tier0Verdict } from "../src/lib/tier0.ts";
import { resolveWarningLevel, type WarningLevel } from "../src/lib/warning-level.ts";
import { reportPanelView, warningLevel } from "../src/popup/report-panel.ts";
import { warningPanelView } from "../src/popup/warning-panel.ts";
import {
  LEGIT_HOST,
  PHISH_HOST,
  SOFT_HOST,
  UNSEEN_HOST,
  blocklistResponse,
  entriesFor,
  fixtureArtifact,
  softFixtureArtifact,
  storeFixture,
  unsupportedFormatResponse,
} from "./helpers/fixture.ts";

const BASE_URL = "https://anti-fraud.omelet.tech";

const FIXTURE_VERSION = 6100;

const NOW = 1_800_000_000_000;

const FALSE_POSITIVE: StoredDispute = {
  host: SOFT_HOST,
  claim: "false_positive",
  reportId: "d27cc0f6-3c94-450c-877b-ba1dfd30e57e",
  filedAt: NOW,
};

const PHISHING_CLAIM: StoredDispute = {
  host: SOFT_HOST,
  claim: "phishing",
  reportId: "fff8ddc8-fff7-4f04-958a-b9aa8913e38f",
  filedAt: NOW,
};

const DISMISSAL: StoredDismissal = { host: SOFT_HOST, dismissedAt: NOW };

const setBadgeText = vi.fn(async (_details: { tabId: number; text: string }) => undefined);
const setBadgeBackgroundColor = vi.fn(
  async (_details: { tabId: number; color: string }) => undefined,
);
const setTitle = vi.fn(async (_details: { tabId: number; title: string }) => undefined);

function badgeText(): string {
  return setBadgeText.mock.lastCall?.[0].text ?? "<không gọi>";
}

function badgeColor(): string {
  return setBadgeBackgroundColor.mock.lastCall?.[0].color ?? "<không gọi>";
}

function badgeTitle(): string {
  return setTitle.mock.lastCall?.[0].title ?? "<không gọi>";
}

async function clearUserState(): Promise<void> {
  for (const host of [PHISH_HOST, LEGIT_HOST, SOFT_HOST, UNSEEN_HOST]) {
    await clearDispute(host);
    await clearDismissal(host);
  }
}

beforeEach(async () => {
  setBadgeText.mockClear();
  setBadgeBackgroundColor.mockClear();
  setTitle.mockClear();
  vi.stubGlobal("chrome", { action: { setBadgeText, setBadgeBackgroundColor, setTitle } });

  await clearStoredBlocklist();
  await clearUserState();
  invalidateTier0Cache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AFBL format 2 mang mảng mềm THỨ BA, không phải một mảng phish to hơn", () => {
  it("header format 2 dài đúng 22 byte và soft_n nằm ngay sau legit_n", async () => {
    expect(AFBL_SOFT_FORMAT).toBe(2);
    expect(AFBL_SOFT_HEADER_BYTES).toBe(22);
    expect(AFBL_SOFT_HEADER_BYTES).toBe(AFBL_HEADER_BYTES + 4);
    expect(AFBL_SOFT_COUNT_OFFSET).toBe(18);

    const bytes = await softFixtureArtifact(FIXTURE_VERSION);
    const view = new DataView(bytes.buffer);

    expect(view.getUint16(4, true)).toBe(2);
    expect(view.getUint32(10, true)).toBe(1);
    expect(view.getUint32(14, true)).toBe(1);
    expect(view.getUint32(AFBL_SOFT_COUNT_OFFSET, true)).toBe(1);
    expect(bytes.byteLength).toBe(22 + 3 * 8);
    expect(bytes.byteLength).toBe(afblByteLength(1, 1, 1, AFBL_SOFT_FORMAT));
  });

  it("decode ra ba mảng rời nhau, và entry mềm KHÔNG có trong mảng phish", async () => {
    const decoded = decodeAfbl(await softFixtureArtifact(FIXTURE_VERSION));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const artifact = decoded.artifact;
    const softEntry = (await entriesFor([SOFT_HOST]))[0];
    const phishEntry = (await entriesFor([PHISH_HOST]))[0];

    expect(artifact.format).toBe(2);
    expect(artifact.phish.length).toBe(1);
    expect(artifact.legit.length).toBe(1);
    expect(artifact.soft.length).toBe(1);

    expect(Array.from(artifact.phish)).toEqual([phishEntry]);
    expect(Array.from(artifact.soft)).toEqual([softEntry]);

    expect(afblContains(artifact.soft, softEntry)).toBe(true);
    expect(afblContains(artifact.phish, softEntry)).toBe(false);
    expect(afblContains(artifact.legit, softEntry)).toBe(false);
    expect(afblContains(artifact.soft, phishEntry)).toBe(false);
  });

  it("format 1 vẫn decode y như cũ và mảng mềm của nó rỗng", async () => {
    const decoded = decodeAfbl(await fixtureArtifact(FIXTURE_VERSION));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    expect(decoded.artifact.format).toBe(1);
    expect(decoded.artifact.soft.length).toBe(0);
    expect(afblContains(decoded.artifact.soft, (await entriesFor([SOFT_HOST]))[0])).toBe(false);
  });

  it("encode format 1 kèm entry mềm thì NÉM LỖI chứ không âm thầm gộp vào phish", async () => {
    const soft = await entriesFor([SOFT_HOST]);
    const phish = await entriesFor([PHISH_HOST]);

    expect(() => encodeAfbl({ version: 5, format: AFBL_FORMAT, phish, legit: [], soft })).toThrow(
      /không có mảng mềm/,
    );

    const format2 = encodeAfbl({ version: 5, format: AFBL_SOFT_FORMAT, phish, legit: [], soft });
    const decoded = decodeAfbl(format2);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(Array.from(decoded.artifact.phish)).toEqual(phish);
    expect(Array.from(decoded.artifact.soft)).toEqual(soft);
  });

  it("format 2 khai soft_n nhiều hơn số byte thật thì từ chối, không đọc bừa", async () => {
    const bytes = await softFixtureArtifact(FIXTURE_VERSION);
    new DataView(bytes.buffer).setUint32(AFBL_SOFT_COUNT_OFFSET, 9, true);

    const decoded = decodeAfbl(bytes);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.refusal.code).toBe("truncated_body");
  });

  it("mảng mềm không tăng ngặt thì từ chối cả artifact, y như hai mảng kia", async () => {
    const bytes = encodeAfbl({
      version: 5,
      format: AFBL_SOFT_FORMAT,
      phish: [],
      legit: [],
      soft: [4n, 9n],
    });
    new DataView(bytes.buffer).setBigUint64(AFBL_SOFT_HEADER_BYTES, 9n, true);
    new DataView(bytes.buffer).setBigUint64(AFBL_SOFT_HEADER_BYTES + 8, 4n, true);

    const decoded = decodeAfbl(bytes);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.refusal.code).toBe("unsorted_entries");
  });
});

describe("một entry mềm không bao giờ trở thành một entry cứng", () => {
  beforeEach(async () => {
    await storeFixture(await softFixtureArtifact(FIXTURE_VERSION), NOW);
    invalidateTier0Cache();
  });

  it("host mềm tra ra verdict soft, host phish tra ra phishing, hai thứ không đổi chỗ", async () => {
    expect((await lookupHost(SOFT_HOST)).verdict).toBe("soft");
    expect((await lookupHost(SOFT_HOST)).verdict).not.toBe("phishing");
    expect((await lookupHost(PHISH_HOST)).verdict).toBe("phishing");
    expect((await lookupHost(LEGIT_HOST)).verdict).toBe("legit");
    expect((await lookupHost(UNSEEN_HOST)).verdict).toBe("unknown");
  });

  it("kho cục bộ giữ ba mảng riêng, không nối mảng mềm vào mảng phish", async () => {
    const record = await readStoredBlocklist();
    expect(record).not.toBeNull();
    if (record === null) return;

    expect(record.format).toBe(2);
    expect(record.phish.length).toBe(1);
    expect(record.soft.length).toBe(1);
    expect(Array.from(record.phish)).toEqual(await entriesFor([PHISH_HOST]));
    expect(Array.from(record.soft)).toEqual(await entriesFor([SOFT_HOST]));
    expect(afblContains(record.phish, await hostEntryOf(SOFT_HOST))).toBe(false);
  });

  it("badge của host mềm là NG màu hổ phách, không phải NG màu đỏ", async () => {
    expect(await evaluateTab(51, `https://${SOFT_HOST}/khuyen-mai`)).toBe("soft");

    expect(badgeText()).toBe("NG");
    expect(badgeText()).toBe(NG_TEXT);
    expect(badgeColor()).toBe("#ef6c00");
    expect(badgeColor()).not.toBe("#c62828");
    expect(badgeColor()).not.toBe(badgeLookFor("phishing").color);

    expect(await evaluateTab(52, `https://${PHISH_HOST}/dang-nhap`)).toBe("phishing");
    expect(badgeText()).toBe("NG");
    expect(badgeColor()).toBe("#c62828");
  });

  it("tooltip mức mềm nói thẳng là máy đánh dấu và chưa người nào kiểm chứng", async () => {
    await evaluateTab(51, `https://${SOFT_HOST}/khuyen-mai`);

    expect(badgeTitle()).toContain("máy đánh dấu");
    expect(badgeTitle()).toContain("chưa có người kiểm chứng");
    expect(badgeTitle()).not.toContain("đã xác nhận");

    await evaluateTab(52, `https://${PHISH_HOST}/dang-nhap`);
    expect(badgeTitle()).toContain("đã xác nhận");
    expect(badgeTitle()).not.toContain("chưa có người kiểm chứng");
  });

  it("badge đỏ và badge hổ phách cùng chữ NG nhưng khác màu và khác tooltip", () => {
    const hard = badgeLookFor("phishing");
    const soft = badgeLookFor("soft");

    expect(soft.text).toBe(hard.text);
    expect(soft.color).not.toBe(hard.color);
    expect(soft.title).not.toBe(hard.title);
    expect(isWarningLook(soft)).toBe(true);
    expect(isWarningLook(hard)).toBe(true);
    expect(isWarningLook(badgeLookFor("legit"))).toBe(false);
    expect(isWarningLook(badgeLookFor("unknown"))).toBe(false);
  });

  it("kết luận is_scam của model trong lượt tự quét cũng là hổ phách, không phải đỏ", () => {
    expect(AUTO_SCAN_WARNING_LOOK.text).toBe(NG_TEXT);
    expect(AUTO_SCAN_WARNING_LOOK.color).toBe(badgeLookFor("soft").color);
    expect(AUTO_SCAN_WARNING_LOOK.color).not.toBe(badgeLookFor("phishing").color);
    expect(AUTO_SCAN_WARNING_LOOK.title).toContain("chưa có người kiểm chứng");
  });
});

describe("bốn mức chồng lên nhau theo đúng một thứ tự", () => {
  const CASES: readonly {
    readonly verdict: Tier0Verdict;
    readonly dispute: StoredDispute | null;
    readonly dismissal: StoredDismissal | null;
    readonly level: WarningLevel;
  }[] = [
    { verdict: "phishing", dispute: null, dismissal: null, level: "hard" },
    { verdict: "soft", dispute: null, dismissal: null, level: "machine" },
    { verdict: "phishing", dispute: FALSE_POSITIVE, dismissal: null, level: "disputed" },
    { verdict: "soft", dispute: FALSE_POSITIVE, dismissal: null, level: "disputed" },
    { verdict: "phishing", dispute: null, dismissal: DISMISSAL, level: "dismissed" },
    { verdict: "soft", dispute: null, dismissal: DISMISSAL, level: "dismissed" },
    { verdict: "phishing", dispute: FALSE_POSITIVE, dismissal: DISMISSAL, level: "dismissed" },
    { verdict: "soft", dispute: FALSE_POSITIVE, dismissal: DISMISSAL, level: "dismissed" },
    { verdict: "phishing", dispute: PHISHING_CLAIM, dismissal: null, level: "hard" },
    { verdict: "soft", dispute: PHISHING_CLAIM, dismissal: null, level: "machine" },
    { verdict: "legit", dispute: FALSE_POSITIVE, dismissal: DISMISSAL, level: "none" },
    { verdict: "unknown", dispute: FALSE_POSITIVE, dismissal: DISMISSAL, level: "none" },
    { verdict: "no_artifact", dispute: FALSE_POSITIVE, dismissal: DISMISSAL, level: "none" },
  ];

  it("tắt hẳn thắng kêu oan, kêu oan thắng mức cứng lẫn mức mềm của server", () => {
    for (const item of CASES) {
      expect(
        resolveWarningLevel(item),
        `${item.verdict} + ${item.dispute?.claim ?? "không report"} + ${item.dismissal === null ? "chưa tắt" : "đã tắt"}`,
      ).toBe(item.level);
    }
    expect(CASES).toHaveLength(13);
  });

  it("badge sơn ra đúng thứ tự ấy, không phải một thứ tự thứ hai sống song song", async () => {
    for (const item of CASES) {
      await clearUserState();
      if (item.dispute !== null) {
        await writeDispute({ ...item.dispute, host: SOFT_HOST });
      }
      if (item.dismissal !== null) {
        await writeDismissal({ ...item.dismissal, host: SOFT_HOST });
      }

      const painted = await userAdjustedLook(SOFT_HOST, badgeLookFor(item.verdict));
      const label = `${item.verdict} + ${item.dispute?.claim ?? "không report"} + ${item.dismissal === null ? "chưa tắt" : "đã tắt"}`;

      expect(lookForLevel(item.verdict, item.level), `popup lệch badge: ${label}`).toEqual(painted);

      if (item.level === "dismissed") {
        expect(painted, label).toEqual(DISMISSED_LOOK);
      } else if (item.level === "disputed") {
        expect(painted, label).toEqual(DISPUTED_LOOK);
      } else if (item.level === "hard") {
        expect(painted, label).toEqual(badgeLookFor("phishing"));
      } else if (item.level === "machine") {
        expect(painted, label).toEqual(badgeLookFor("soft"));
      } else {
        expect(painted, label).toEqual(badgeLookFor(item.verdict));
      }
    }
  });

  it("kêu oan trên host mềm hạ badge, và không đụng tới host khác", async () => {
    await storeFixture(await softFixtureArtifact(FIXTURE_VERSION), NOW);
    invalidateTier0Cache();

    await writeDispute(FALSE_POSITIVE);

    expect(await evaluateTab(61, `https://${SOFT_HOST}/khuyen-mai`)).toBe("soft");
    expect(badgeText()).toBe(DISPUTED_LOOK.text);
    expect(badgeColor()).toBe(DISPUTED_LOOK.color);
    expect(badgeColor()).not.toBe(badgeLookFor("soft").color);

    expect(await evaluateTab(62, `https://${PHISH_HOST}/dang-nhap`)).toBe("phishing");
    expect(badgeText()).toBe(NG_TEXT);
    expect(badgeColor()).toBe(badgeLookFor("phishing").color);
  });

  it("tắt hẳn nuốt luôn badge mềm của server", async () => {
    await storeFixture(await softFixtureArtifact(FIXTURE_VERSION), NOW);
    invalidateTier0Cache();

    await writeDismissal(DISMISSAL);

    expect(await evaluateTab(63, `https://${SOFT_HOST}/khuyen-mai`)).toBe("soft");
    expect(badgeText()).toBe(DISMISSED_LOOK.text);
    expect(badgeText()).toBe(OK_TEXT);
    expect(badgeText()).not.toBe("");
    expect(badgeColor()).toBe(DISMISSED_LOOK.color);
  });
});

describe("popup nói đúng sự thật về hai mức, vì hai mức đáng tin khác nhau", () => {
  it("mức mềm: một lượt báo nhầm gỡ cho MỌI NGƯỜI, không cần moderator", () => {
    expect(warningLevel("soft", null)).toBe("machine");

    const view = reportPanelView({ kind: "ready", verdict: "soft", dispute: null });

    expect(view.headline).toContain("Máy đánh dấu trang này");
    expect(view.detail).toContain("chưa có người nào kiểm chứng");
    expect(view.detail).toContain("0.9675");
    expect(view.detail).toContain("cho mọi máy đang cài extension");
    expect(view.detail).toContain("không phải chờ moderator");
    expect(view.detail).toContain("Báo cảnh báo nhầm");
    expect(view.falsePositiveEnabled).toBe(true);
  });

  it("mức cứng: cùng cú bấm ấy chỉ vào hàng chờ và chỉ hạ trên máy bạn", () => {
    expect(warningLevel("phishing", null)).toBe("hard");

    const view = reportPanelView({ kind: "ready", verdict: "phishing", dispute: null });

    expect(view.detail).toContain("Một người đã xem trang này và kết luận");
    expect(view.detail).toContain("chỉ vào hàng chờ moderator");
    expect(view.detail).toContain("chỉ hạ cảnh báo trên máy bạn");
    expect(view.detail).not.toContain("cho mọi máy đang cài extension");
  });

  it("hai lời dặn ấy không được giống nhau, vì hai hành vi không giống nhau", () => {
    const soft = reportPanelView({ kind: "ready", verdict: "soft", dispute: null });
    const hard = reportPanelView({ kind: "ready", verdict: "phishing", dispute: null });

    expect(soft.headline).not.toBe(hard.headline);
    expect(soft.detail).not.toBe(hard.detail);
  });

  it("panel cảnh báo phân biệt màu hổ phách với màu đỏ bằng chữ, không chỉ bằng màu", () => {
    const machine = warningPanelView({ kind: "ready", level: "machine", dismissal: null });
    const hard = warningPanelView({ kind: "ready", level: "hard", dismissal: null });

    expect(machine.warningVisible).toBe(true);
    expect(machine.headline).toContain("chưa có người kiểm chứng");
    expect(machine.detail).toContain("hổ phách");
    expect(machine.detail).toContain("Màu đỏ mới là mức đã có người xem và kết luận");
    expect(machine.detail).toContain("không chặn");
    expect(machine.buttonEnabled).toBe(true);

    expect(hard.headline).toContain("một người đã xác nhận");
    expect(hard.headline).not.toBe(machine.headline);
  });

  it("server trả soft_flag withdrawn thì popup nói cờ mềm đã bị rút cho mọi người", () => {
    const view = reportPanelView({
      kind: "filed",
      outcome: {
        kind: "queued",
        reportId: FALSE_POSITIVE.reportId,
        gate: "not-required",
        claim: "false_positive",
        softened: true,
        softFlag: "withdrawn",
      },
      dispute: FALSE_POSITIVE,
    });

    expect(view.detail).toContain("withdrawn");
    expect(view.detail).toContain("cho mọi người");
  });

  it("server chưa trả soft_flag thì popup nói thẳng là chưa biết, không đoán bừa", () => {
    const view = reportPanelView({
      kind: "filed",
      outcome: {
        kind: "queued",
        reportId: FALSE_POSITIVE.reportId,
        gate: "not-required",
        claim: "false_positive",
        softened: true,
        softFlag: null,
      },
      dispute: FALSE_POSITIVE,
    });

    expect(view.detail).toContain("chưa trả trường soft_flag");
    expect(view.detail).not.toContain("withdrawn");
  });
});

describe("đồng bộ xin format 2 nhưng sống được với server chỉ biết format 1", () => {
  it("server đã có format 2 thì client nhận đủ ba mảng", async () => {
    const bytes = await softFixtureArtifact(FIXTURE_VERSION);
    const outcome = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async () =>
        blocklistResponse(bytes, FIXTURE_VERSION, AFBL_PREFERRED_FORMAT, 1)) as unknown as typeof fetch,
    });

    expect(outcome.kind).toBe("fresh");
    if (outcome.kind !== "fresh") return;
    expect(outcome.format).toBe(2);
    expect(outcome.phishCount).toBe(1);
    expect(outcome.legitCount).toBe(1);
    expect(outcome.softCount).toBe(1);

    invalidateTier0Cache();
    expect((await lookupHost(SOFT_HOST)).verdict).toBe("soft");
  });

  it("server chưa deploy format 2 thì rơi về format 1, mảng mềm rỗng, và đó KHÔNG phải lỗi", async () => {
    const asked: string[] = [];
    const outcome = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async (input: string) => {
        asked.push(new URL(String(input)).searchParams.get("format") ?? "<không có>");
        return new URL(String(input)).searchParams.get("format") === "2"
          ? unsupportedFormatResponse(2)
          : blocklistResponse(await fixtureArtifact(FIXTURE_VERSION), FIXTURE_VERSION, 1);
      }) as unknown as typeof fetch,
    });

    expect(asked).toEqual(["2", "1"]);
    expect(outcome.kind).toBe("fresh");
    if (outcome.kind !== "fresh") return;
    expect(outcome.format).toBe(1);
    expect(outcome.softCount).toBe(0);

    const record = await readStoredBlocklist();
    expect(record?.format).toBe(1);
    expect(record?.soft.length).toBe(0);

    invalidateTier0Cache();
    expect((await lookupHost(SOFT_HOST)).verdict).toBe("unknown");
    expect((await lookupHost(PHISH_HOST)).verdict).toBe("phishing");
  });

  it("header x-blocklist-soft-count lệch với byte thứ 18 thì từ chối, giữ bản đang có", async () => {
    await storeFixture(await fixtureArtifact(FIXTURE_VERSION), NOW);

    const bytes = await softFixtureArtifact(FIXTURE_VERSION + 1);
    const outcome = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async () =>
        blocklistResponse(bytes, FIXTURE_VERSION + 1, AFBL_PREFERRED_FORMAT, 7)) as unknown as typeof fetch,
    });

    expect(outcome.kind).toBe("refused");
    expect((await readStoredBlocklist())?.version).toBe(FIXTURE_VERSION);
  });

  it("mỗi format đếm version riêng, nên đổi format không bị coi là version lùi", async () => {
    await storeFixture(await softFixtureArtifact(900), NOW);
    expect((await readStoredBlocklist())?.format).toBe(2);

    const outcome = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async (input: string) =>
        new URL(String(input)).searchParams.get("format") === "2"
          ? unsupportedFormatResponse(2)
          : blocklistResponse(await fixtureArtifact(12), 12, 1)) as unknown as typeof fetch,
    });

    expect(outcome.kind).toBe("fresh");
    expect((await readStoredBlocklist())?.version).toBe(12);
    expect((await readStoredBlocklist())?.format).toBe(1);
  });

  it("cùng format thì version lùi vẫn bị từ chối như trước", async () => {
    await storeFixture(await softFixtureArtifact(900), NOW);

    const outcome = await syncBlocklist({
      baseUrl: BASE_URL,
      fetchImpl: (async () =>
        blocklistResponse(
          await softFixtureArtifact(899),
          899,
          AFBL_PREFERRED_FORMAT,
          1,
        )) as unknown as typeof fetch,
    });

    expect(outcome.kind).toBe("rejected_older");
    expect((await readStoredBlocklist())?.version).toBe(900);
  });
});

describe("host đã mang cờ mềm thì cổng tự quét không tiêu thêm một lượt nào", () => {
  const day = { day: "2026-08-23", entries: [] as const };

  function contextFor(verdict: "unknown" | "soft" | "legit" | "phishing") {
    return {
      url: `https://${SOFT_HOST}/khuyen-mai`,
      host: SOFT_HOST,
      verdict,
      enabled: true,
      risk: scoreHost("nhacai-mot.top"),
      day,
      memory: [day],
    };
  }

  it("soft đứng cùng phía với legit và phishing: đã có kết luận thì không quét lại", () => {
    expect(decideAutoScan(contextFor("soft"))).toEqual({
      kind: "skip",
      reason: "verdict_known",
      risk: scoreHost("nhacai-mot.top"),
    });
    expect(decideAutoScan(contextFor("legit")).kind).toBe("skip");
    expect(decideAutoScan(contextFor("phishing")).kind).toBe("skip");
    expect(decideAutoScan(contextFor("unknown")).kind).toBe("scan");
  });

  it("verdict soft đi qua được lớp chuyển kiểu của background chứ không bị hạ thành unknown", () => {
    expect(knownVerdictOf("soft")).toBe("soft");
    expect(knownVerdictOf("phishing")).toBe("phishing");
    expect(knownVerdictOf("legit")).toBe("legit");
    expect(knownVerdictOf("no_artifact")).toBe("unknown");
    expect(knownVerdictOf("absent")).toBe("unknown");
  });
});

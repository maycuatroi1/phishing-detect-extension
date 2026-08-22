export const RISK_THRESHOLD = 4;

export const RISK_SIGNAL_IDS = [
  "bare-ip",
  "punycode",
  "free-host",
  "diploma-fraud",
  "gambling-word",
  "credential-lure",
  "brand-lookalike",
  "investment-lure",
  "crypto-lure",
  "topup-lure",
  "vn-glued",
  "cheap-tld",
  "digits",
  "lucky-tail",
  "hyphens",
  "deep-subdomain",
  "long-host",
  "random-label",
] as const;

export type RiskSignalId = (typeof RISK_SIGNAL_IDS)[number];

export interface RiskSignal {
  readonly id: RiskSignalId;
  readonly weight: number;
  readonly note: string;
}

export interface HostRisk {
  readonly host: string;
  readonly score: number;
  readonly exempt: boolean;
  readonly exemptReason: string | null;
  readonly signals: readonly RiskSignal[];
}

export const GATED_SUFFIXES: readonly string[] = [
  "gov.vn",
  "dcs.vn",
  "gov",
  "mil",
  "int",
  "gov.uk",
  "gov.au",
  "gov.sg",
];

export const DROPPED_GATED_SUFFIXES: readonly string[] = [
  "edu.vn",
  "ac.vn",
  "org.vn",
  "edu",
  "ac.uk",
  "edu.au",
  "edu.sg",
];

export const GATED_MEANS_NOT_FOR_SALE =
  "Miễn quét là nói rằng đuôi này không mua trôi nổi được, nên một trang lừa đảo không dựng lên " +
  "dưới đó được. Câu đó đúng với đuôi của cơ quan nhà nước và quân đội, và sai với đuôi trường " +
  "học: một trang sinh viên bị chiếm hoặc một subdomain bị bỏ quên là đường dựng trang lừa đảo cũ " +
  "bằng chính Internet. Đo trên corpus production ngày 2026-08-23: .gov.vn có 701 host, 0 host lừa " +
  "đảo; .edu.vn có 68 host và trong đó có dichvu4g.edu.vn đã được người xác nhận là lừa đảo. Một " +
  "counterexample là đủ, vì miễn quét nghĩa là KHÔNG BAO GIỜ nhìn tới nó.";

export const MULTI_LABEL_SUFFIXES: readonly string[] = [
  "com.vn",
  "net.vn",
  "org.vn",
  "gov.vn",
  "edu.vn",
  "ac.vn",
  "biz.vn",
  "info.vn",
  "name.vn",
  "pro.vn",
  "health.vn",
  "int.vn",
  "dcs.vn",
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "org.au",
  "com.br",
  "com.cn",
  "com.hk",
  "com.tw",
  "com.sg",
  "com.my",
  "com.ph",
  "com.tr",
  "com.mx",
  "com.ar",
  "co.id",
  "ac.id",
  "co.th",
  "co.jp",
  "co.kr",
  "co.in",
  "co.za",
  "co.nz",
  "us.com",
  "eu.com",
  "uk.com",
];

export const FREE_HOST_SUFFIXES: readonly string[] = [
  "pages.dev",
  "workers.dev",
  "r2.dev",
  "vercel.app",
  "netlify.app",
  "web.app",
  "firebaseapp.com",
  "github.io",
  "gitlab.io",
  "glitch.me",
  "repl.co",
  "replit.app",
  "onrender.com",
  "herokuapp.com",
  "surge.sh",
  "blogspot.com",
  "wordpress.com",
  "weebly.com",
  "wixsite.com",
  "webflow.io",
  "framer.website",
  "notion.site",
  "carrd.co",
  "square.site",
  "myshopify.com",
  "bubbleapps.io",
  "softr.app",
  "godaddysites.com",
  "000webhostapp.com",
  "sites.google.com",
  "canva.site",
  "azurewebsites.net",
  "amplifyapp.com",
  "typedream.app",
  "durable.co",
  "lovable.app",
  "streamlit.app",
  "ngrok.io",
  "ngrok-free.app",
  "trycloudflare.com",
];

export const CHEAP_TLDS: readonly string[] = [
  "top",
  "xyz",
  "icu",
  "cc",
  "club",
  "live",
  "buzz",
  "work",
  "rest",
  "shop",
  "online",
  "site",
  "space",
  "website",
  "fun",
  "cyou",
  "sbs",
  "win",
  "bid",
  "loan",
  "men",
  "gq",
  "cf",
  "ga",
  "ml",
  "tk",
  "pw",
  "mom",
  "cfd",
  "quest",
  "autos",
  "bond",
  "lol",
  "makeup",
  "skin",
  "hair",
  "beauty",
  "monster",
  "click",
  "link",
  "download",
  "stream",
  "review",
  "country",
  "party",
  "science",
  "date",
  "faith",
  "racing",
  "accountant",
  "cricket",
  "trade",
  "webcam",
  "gdn",
  "casa",
  "wang",
  "xin",
  "mobi",
  "pro",
  "one",
  "uno",
  "cam",
  "ws",
  "su",
  "vc",
  "gg",
  "mu",
  "tv",
  "info",
  "co",
  "me",
];

export const DIPLOMA_FRAUD_WORDS: readonly string[] = [
  "lambang",
  "bangcap",
  "bangdaihoc",
  "bangthpt",
  "banggia",
  "chungchi",
  "bangnghe",
  "bangtoeic",
  "bangielts",
  "hocba",
];

export const GAMBLING_WORDS: readonly string[] = [
  "casino",
  "poker",
  "baccarat",
  "sicbo",
  "jackpot",
  "roulette",
  "lottery",
  "keno",
  "nohu",
  "taixiu",
  "xocdia",
  "xoso",
  "lode",
  "nhacai",
  "soicau",
  "danhbai",
  "gamebai",
  "choibai",
  "quayhu",
  "cacuoc",
  "keonhacai",
  "tylekeo",
  "rikvip",
  "sunwin",
  "dagathomo",
  "sportsbook",
  "bookmaker",
  "betting",
];

export const DIGIT_BOUND_GAMBLING_WORDS: readonly string[] = [
  "bet",
  "win",
  "vip",
  "slot",
  "club",
  "luck",
  "sanh",
  "hu",
];

export const CREDENTIAL_LURE_WORDS: readonly string[] = [
  "otp",
  "xacthuc",
  "dangnhap",
  "matkhau",
  "taikhoan",
  "capnhat",
  "vneid",
  "dinhdanh",
  "dichvucong",
  "thuedientu",
  "baohiemxahoi",
  "canhsat",
  "congan",
  "verifyaccount",
  "securelogin",
  "accountverify",
  "loginverify",
];

export const BRAND_WORDS: readonly string[] = [
  "vietcombank",
  "vietinbank",
  "techcombank",
  "agribank",
  "sacombank",
  "mbbank",
  "vpbank",
  "tpbank",
  "hdbank",
  "seabank",
  "eximbank",
  "lienvietpostbank",
  "bidv",
  "napas",
  "momo",
  "zalopay",
  "viettelpay",
  "vnpay",
  "shopeepay",
  "smartbanking",
  "internetbanking",
  "ebanking",
  "facebook",
  "google",
  "gmail",
  "apple",
  "icloud",
  "microsoft",
  "netflix",
  "paypal",
  "binance",
  "metamask",
  "coinbase",
  "tiktok",
  "shopee",
  "lazada",
  "sendo",
  "viettel",
  "vnpt",
  "mobifone",
  "vinaphone",
  "dienluc",
];

export const INVESTMENT_LURE_WORDS: readonly string[] = [
  "trade",
  "trading",
  "trader",
  "market",
  "finance",
  "financial",
  "invest",
  "capital",
  "broker",
  "exchange",
  "funding",
  "forex",
  "profit",
  "wealth",
  "kiemtien",
  "lamgiau",
  "dautu",
  "sanforex",
  "copytrade",
  "vaytien",
  "hoantien",
  "trungthuong",
];

export const CRYPTO_LURE_WORDS: readonly string[] = [
  "coin",
  "crypto",
  "usdt",
  "bitcoin",
  "defi",
  "mining",
  "wallet",
  "blockchain",
  "airdrop",
  "staking",
  "nft",
];

export const TOPUP_LURE_WORDS: readonly string[] = [
  "robux",
  "blox",
  "napthe",
  "naptien",
  "freefire",
  "giftcode",
  "muaacc",
  "banacc",
  "accgame",
  "nickgame",
  "hackgame",
  "cheat",
  "thecao",
  "muaban",
];

export const PRIVATE_NAME_SUFFIXES: readonly string[] = [
  "localhost",
  "local",
  "internal",
  "lan",
  "home",
  "home.arpa",
  "test",
  "invalid",
  "example",
];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const LUCKY_TAIL = /(?:88|68|89|79|66|99|777|888|999)$/;

const VN_GLUED = /^vn[a-z0-9]|[a-z0-9]vn$/;

const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

function endsWithSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function ipv4Octets(host: string): number[] | null {
  const match = IPV4.exec(host);
  if (match === null) {
    return null;
  }
  const octets = match.slice(1).map((part) => Number(part));
  return octets.every((part) => part <= 255) ? octets : null;
}

export function isBareIp(host: string): boolean {
  return host.includes(":") || ipv4Octets(host) !== null;
}

export function isPrivateHost(host: string): boolean {
  if (!host.includes(".")) {
    return true;
  }
  if (PRIVATE_NAME_SUFFIXES.some((suffix) => endsWithSuffix(host, suffix))) {
    return true;
  }
  if (host.includes(":")) {
    return host.startsWith("::") || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  }
  const octets = ipv4Octets(host);
  if (octets === null) {
    return false;
  }
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export function publicSuffixOf(host: string): string {
  const labels = host.split(".");
  if (labels.length >= 3) {
    const twoLabel = labels.slice(-2).join(".");
    if (MULTI_LABEL_SUFFIXES.includes(twoLabel)) {
      return twoLabel;
    }
  }
  return labels[labels.length - 1] ?? "";
}

function headOf(host: string): string {
  const suffix = publicSuffixOf(host);
  return host.slice(0, Math.max(host.length - suffix.length - 1, 0));
}

export function registrableLabelOf(host: string): string {
  const labels = headOf(host).split(".");
  return labels[labels.length - 1] ?? "";
}

export function subdomainDepthOf(host: string): number {
  const head = headOf(host);
  return head.length === 0 ? 0 : head.split(".").length - 1;
}

export function freeHostSuffixOf(host: string): string | null {
  for (const suffix of FREE_HOST_SUFFIXES) {
    if (host.endsWith(`.${suffix}`)) {
      return suffix;
    }
  }
  return null;
}

export function longestDigitRun(text: string): number {
  let best = 0;
  let run = 0;
  for (const char of text) {
    if (char >= "0" && char <= "9") {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isLetter(char: string | undefined): boolean {
  return char !== undefined && char >= "a" && char <= "z";
}

export function containsBoundedWord(text: string, word: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(word, from);
    if (at < 0) {
      return false;
    }
    const before = at === 0 ? undefined : text[at - 1];
    const after = text[at + word.length];
    if ((!isLetter(before) || isDigit(after)) && (!isLetter(after) || isDigit(before))) {
      return true;
    }
    from = at + 1;
  }
}

export function looksRandom(label: string): boolean {
  const letters = Array.from(label).filter((char) => isLetter(char));
  if (letters.length < 5) {
    return false;
  }
  const vowels = letters.filter((char) => VOWELS.has(char)).length;
  return vowels / letters.length < 0.2;
}

export function hasLuckyTail(label: string): boolean {
  return LUCKY_TAIL.test(label);
}

export function isVnGlued(host: string): boolean {
  if (host.endsWith(".vn")) {
    return false;
  }
  const label = registrableLabelOf(host);
  return label.length >= 4 && VN_GLUED.test(label);
}

function firstWord(text: string, words: readonly string[]): string | undefined {
  return words.find((word) => text.includes(word));
}

function collect(host: string): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const labels = host.split(".");
  const tld = labels[labels.length - 1] ?? "";
  const registrable = registrableLabelOf(host);
  const flat = host.replace(/[^a-z0-9]/g, "");

  if (isBareIp(host)) {
    signals.push({
      id: "bare-ip",
      weight: 4,
      note: "Địa chỉ là IP trần, không có tên miền nào đứng sau nó.",
    });
  }

  if (labels.some((label) => label.startsWith("xn--"))) {
    signals.push({
      id: "punycode",
      weight: 4,
      note: "Tên miền dùng punycode xn--, cách phổ biến để giả chữ cái của một thương hiệu thật.",
    });
  }

  const free = freeHostSuffixOf(host);
  if (free !== null) {
    signals.push({
      id: "free-host",
      weight: 3,
      note: `Trang nằm trên nền tảng host miễn phí ${free}, nơi ai cũng dựng được một subdomain trong vài phút.`,
    });
  }

  const diploma = firstWord(flat, DIPLOMA_FRAUD_WORDS);
  if (diploma !== undefined) {
    signals.push({
      id: "diploma-fraud",
      weight: 4,
      note: `Tên miền chứa "${diploma}", từ khoá của dịch vụ làm bằng cấp giả.`,
    });
  }

  const gambling =
    firstWord(flat, GAMBLING_WORDS) ??
    DIGIT_BOUND_GAMBLING_WORDS.find((word) => containsBoundedWord(host, word));
  if (gambling !== undefined) {
    signals.push({
      id: "gambling-word",
      weight: 4,
      note: `Tên miền chứa từ khoá cờ bạc "${gambling}".`,
    });
  }

  const credential = firstWord(flat, CREDENTIAL_LURE_WORDS);
  if (credential !== undefined) {
    signals.push({
      id: "credential-lure",
      weight: 4,
      note: `Tên miền chứa "${credential}", từ khoá của trang dụ nhập tài khoản hoặc mã OTP.`,
    });
  }

  const brand = firstWord(flat, BRAND_WORDS);
  if (brand !== undefined && registrable !== brand) {
    signals.push({
      id: "brand-lookalike",
      weight: 3,
      note: `Tên miền mượn tên thương hiệu "${brand}" nhưng tên miền gốc lại là "${registrable}", không phải tên miền chính thức của thương hiệu đó.`,
    });
  }

  const investment = firstWord(flat, INVESTMENT_LURE_WORDS);
  if (investment !== undefined) {
    signals.push({
      id: "investment-lure",
      weight: 2,
      note: `Tên miền chứa "${investment}", từ khoá hay gặp ở sàn đầu tư và sàn forex dựng lên để ôm tiền.`,
    });
  }

  const crypto = firstWord(flat, CRYPTO_LURE_WORDS);
  if (crypto !== undefined) {
    signals.push({
      id: "crypto-lure",
      weight: 2,
      note: `Tên miền chứa "${crypto}", từ khoá tiền mã hoá hay dùng để dụ nạp tiền.`,
    });
  }

  const topup = firstWord(flat, TOPUP_LURE_WORDS);
  if (topup !== undefined) {
    signals.push({
      id: "topup-lure",
      weight: 2,
      note: `Tên miền chứa "${topup}", từ khoá của dịch vụ nạp thẻ, mua bán tài khoản game.`,
    });
  }

  if (isVnGlued(host)) {
    signals.push({
      id: "vn-glued",
      weight: 2,
      note: `Tên miền gốc "${registrable}" gắn chữ vn để nhắm người dùng Việt Nam nhưng lại không đăng ký dưới đuôi .vn do VNNIC quản.`,
    });
  }

  if (CHEAP_TLDS.includes(tld)) {
    signals.push({
      id: "cheap-tld",
      weight: 2,
      note: `Đuôi .${tld} là đuôi rẻ và bị lạm dụng nhiều, đăng ký hàng loạt gần như không tốn gì.`,
    });
  }

  const digits = longestDigitRun(registrable);
  if (digits >= 5) {
    signals.push({
      id: "digits",
      weight: 3,
      note: `Tên miền gốc có ${digits} chữ số liền nhau, dấu hiệu của tên miền sinh hàng loạt.`,
    });
  } else if (digits >= 3) {
    signals.push({
      id: "digits",
      weight: 2,
      note: `Tên miền gốc có ${digits} chữ số liền nhau.`,
    });
  } else if (digits >= 1) {
    signals.push({
      id: "digits",
      weight: 1,
      note: "Tên miền gốc có chữ số lẫn vào giữa chữ cái.",
    });
  }

  if (hasLuckyTail(registrable)) {
    signals.push({
      id: "lucky-tail",
      weight: 1,
      note: "Tên miền gốc kết thúc bằng dãy số may mắn kiểu nhà cái, ví dụ 88, 68, 99.",
    });
  }

  const hyphens = (host.match(/-/g) ?? []).length;
  if (hyphens >= 4) {
    signals.push({
      id: "hyphens",
      weight: 2,
      note: `Host có ${hyphens} dấu gạch ngang, thường là cách ghép nhiều từ khoá vào một tên miền.`,
    });
  } else if (hyphens >= 1) {
    signals.push({
      id: "hyphens",
      weight: 1,
      note: `Host có ${hyphens} dấu gạch ngang.`,
    });
  }

  const depth = subdomainDepthOf(host);
  if (depth >= 3) {
    signals.push({
      id: "deep-subdomain",
      weight: 2,
      note: `Host sâu ${depth} cấp subdomain, sâu bất thường so với một trang bình thường.`,
    });
  }

  if (host.length >= 28) {
    signals.push({
      id: "long-host",
      weight: 1,
      note: `Host dài ${host.length} ký tự.`,
    });
  }

  if (looksRandom(registrable)) {
    signals.push({
      id: "random-label",
      weight: 2,
      note: `Tên miền gốc "${registrable}" gần như không có nguyên âm, trông như chuỗi sinh máy.`,
    });
  }

  return signals;
}

export function exemptionOf(host: string): string | null {
  if (isPrivateHost(host)) {
    return "Địa chỉ nội bộ hoặc tên máy trong mạng riêng, server không tra được và cũng không có lý do gì để tra.";
  }
  const gated = GATED_SUFFIXES.find((suffix) => endsWithSuffix(host, suffix));
  if (gated !== undefined) {
    return `Đuôi .${gated} do cơ quan đăng ký cấp có kiểm tra pháp nhân, không mua trôi nổi được.`;
  }
  return null;
}

export function scoreHost(host: string): HostRisk {
  const normalized = host.trim().toLowerCase().replace(/\.+$/, "");

  if (normalized.length === 0) {
    return {
      host: normalized,
      score: 0,
      exempt: true,
      exemptReason: "Không rút được host nào từ tab này.",
      signals: [],
    };
  }

  const exemptReason = exemptionOf(normalized);
  if (exemptReason !== null) {
    return { host: normalized, score: 0, exempt: true, exemptReason, signals: [] };
  }

  const signals = collect(normalized);
  const score = signals.reduce((total, signal) => total + signal.weight, 0);
  return { host: normalized, score, exempt: false, exemptReason: null, signals };
}

export function isHighRisk(risk: HostRisk): boolean {
  return !risk.exempt && risk.score >= RISK_THRESHOLD;
}

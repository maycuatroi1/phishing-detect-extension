import { API_BASE_URL, IMPLEMENTED_TIERS } from "../config.ts";
import { evaluateTabWithAutoScan } from "./auto-scan.ts";
import { registerTier0 } from "./tier0.ts";

chrome.runtime.onInstalled.addListener((details) => {
  console.info("[phishing-detect] installed", details.reason, API_BASE_URL, IMPLEMENTED_TIERS.length);
});

chrome.runtime.onStartup.addListener(() => {
  console.info("[phishing-detect] service worker started", API_BASE_URL);
});

registerTier0(evaluateTabWithAutoScan);

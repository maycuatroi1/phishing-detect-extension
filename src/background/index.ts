import { API_BASE_URL, IMPLEMENTED_TIERS } from "../config.ts";

chrome.runtime.onInstalled.addListener((details) => {
  console.info("[phishing-detect] installed", details.reason, API_BASE_URL, IMPLEMENTED_TIERS.length);
});

chrome.runtime.onStartup.addListener(() => {
  console.info("[phishing-detect] service worker started", API_BASE_URL);
});

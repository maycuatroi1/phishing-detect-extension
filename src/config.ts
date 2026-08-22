export const DEFAULT_API_BASE_URL = "https://anti-fraud.omelet.tech";

export const API_BASE_URL = import.meta.env.PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

export const IMPLEMENTED_TIERS: readonly string[] = ["tier0", "tier1", "tier2", "tier3"];

import { API_BASE_URL, IMPLEMENTED_TIERS } from "../config.ts";

const originSlot = document.querySelector<HTMLElement>("[data-slot='api-base-url']");
if (originSlot) {
  originSlot.textContent = API_BASE_URL;
}

const tierSlot = document.querySelector<HTMLElement>("[data-slot='tiers']");
if (tierSlot) {
  tierSlot.textContent =
    IMPLEMENTED_TIERS.length === 0 ? "Chưa có tier nào được bật" : IMPLEMENTED_TIERS.join(", ");
}

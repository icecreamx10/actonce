export const CHROME_PACKAGE = "com.android.chrome";
export const CHROME_TERMS_ACCEPT_ID = `${CHROME_PACKAGE}:id/terms_accept`;
export const CHROME_NEGATIVE_BUTTON_ID = `${CHROME_PACKAGE}:id/negative_button`;
export const CHROME_PROMO_SECONDARY_ID = `${CHROME_PACKAGE}:id/button_secondary`;
const CHROME_READY_IDS = [
  `${CHROME_PACKAGE}:id/search_box_text`,
  `${CHROME_PACKAGE}:id/url_bar`,
] as const;

export type Point = { x: number; y: number };

export function findEnabledNodeCenterByResourceId(xml: string, resourceId: string): Point | null {
  for (const node of xml.matchAll(/<node\b[^>]*\/>/g)) {
    const source = node[0];
    if (attribute(source, "resource-id") !== resourceId) continue;
    if (attribute(source, "enabled") === "false" || attribute(source, "clickable") === "false") continue;
    const bounds = attribute(source, "bounds")?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
    if (!bounds) continue;
    const [, left, top, right, bottom] = bounds.map(Number);
    if (right <= left || bottom <= top) continue;
    return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
  }
  return null;
}

export function isChromeReady(xml: string) {
  return CHROME_READY_IDS.some((resourceId) => xml.includes(`resource-id="${resourceId}"`));
}

export function nextChromeFixtureAction(xml: string) {
  for (const resourceId of [CHROME_TERMS_ACCEPT_ID, CHROME_NEGATIVE_BUTTON_ID, CHROME_PROMO_SECONDARY_ID]) {
    const point = findEnabledNodeCenterByResourceId(xml, resourceId);
    if (point) return { resourceId, point };
  }
  return null;
}

function attribute(node: string, name: string) {
  return node.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

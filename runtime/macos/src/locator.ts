import type { MacLocator } from "./types.js";

export function locatorToWebdriver(locator: MacLocator): string {
  if ("accessibilityId" in locator) return `~${locator.accessibilityId}`;
  if ("id" in locator) return `id:${locator.id}`;
  if ("name" in locator) return `name:${locator.name}`;
  if ("className" in locator) return `class name:${locator.className}`;
  if ("predicate" in locator) return `-ios predicate string:${locator.predicate}`;
  if ("classChain" in locator) return `-ios class chain:${locator.classChain}`;
  if ("xpath" in locator) return locator.xpath;
  return locator.raw;
}

export function describeLocator(locator: MacLocator): string {
  const [kind, value] = Object.entries(locator)[0] ?? ["unknown", ""];
  return `${kind}=${String(value)}`;
}

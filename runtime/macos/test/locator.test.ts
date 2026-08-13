import { describe, expect, it } from "vitest";
import { locatorToWebdriver } from "../src/locator.js";

describe("locatorToWebdriver", () => {
  it.each([
    [{ accessibilityId: "Save" }, "~Save"],
    [{ id: "editor" }, "id:editor"],
    [{ name: "File" }, "name:File"],
    [{ className: "XCUIElementTypeButton" }, "class name:XCUIElementTypeButton"],
    [{ predicate: "label == 'Save'" }, "-ios predicate string:label == 'Save'"],
    [{ classChain: "**/XCUIElementTypeButton" }, "-ios class chain:**/XCUIElementTypeButton"],
    [{ xpath: "//XCUIElementTypeButton" }, "//XCUIElementTypeButton"],
    [{ raw: "custom=value" }, "custom=value"],
  ] as const)("maps %j", (locator, expected) => {
    expect(locatorToWebdriver(locator)).toBe(expected);
  });
});

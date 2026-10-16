import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { androidNodeSelectorXPath, androidNormalizedSourceToUiTree, normalizeAndroidSource, androidUiAutomatorXmlToUiTree, findAndroidUiTreeNodes, NativeAndroidDevice, validateAndroidNodeSelector } from "../src/native-device.js";
import { replayAndroidPrimitive } from "../src/primitives.js";
import type { AndroidNodeSelector } from "../src/types.js";

const selector: AndroidNodeSelector = {
  type: "Image", resourceId: "menu",
  withinParent: { selector: { type: "Row" }, sibling: { type: "Label", text: "Chosen" } },
};
const label = (text = "Chosen") => `<node class="Label" text="${text}"/>`;
const menu = '<node class="Image" resource-id="menu"/>';
const row = (contents = label() + menu, type = "Row") => `<node class="${type}">${contents}</node>`;
const xml = (contents: string) => `<hierarchy><node class="Root">${contents}</node></hierarchy>`;
const matches = (source: string, query = selector) => findAndroidUiTreeNodes(androidUiAutomatorXmlToUiTree(source).root, query);

describe("direct row context selectors", () => {
  it.each([
    ["repeated menus", xml(row(label("Other") + menu) + row()), 1],
    ["duplicate rows", xml(row() + row()), 2],
    ["two menus in one row", xml(row(label() + menu + menu)), 2],
    ["wrong parent", xml(row(label() + menu, "Other")), 0],
    ["nested context is not a sibling", xml(row(row(label()) + menu)), 0],
    ["nested target is not in the row", xml(row(label() + row(menu, "Wrapper"))), 0],
    ["unrelated row cannot supply context", xml(row(label()) + row(menu)), 0],
    ["root cannot supply a parent", `<hierarchy>${menu}</hierarchy>`, 0],
    ["target cannot be its own sibling", xml(row(label())), 0],
  ])("matches %s without broadening scope", (_name, source, count) => {
    expect(matches(source)).toHaveLength(count);
  });

  it("rejects duplicate context labels rather than choosing the first", () => {
    expect(() => matches(xml(row(label() + label() + menu)))).toThrow("context is ambiguous");
  });
  it("restores the same direct ancestry from normalized source JSON", () => {
    for (const source of [xml(row()), xml(row() + row()), xml(row(label()) + row(menu)), xml(row(row(label()) + menu))]) {
      expect(findAndroidUiTreeNodes(androidNormalizedSourceToUiTree(normalizeAndroidSource(source)), selector)).toHaveLength(matches(source).length);
    }
    expect(() => findAndroidUiTreeNodes(androidNormalizedSourceToUiTree(normalizeAndroidSource(xml(row(label() + label() + menu)))), selector)).toThrow("ambiguous");
    const syntheticParent = { ...selector, withinParent: { selector: { type: "hierarchy" }, sibling: { type: "Label", text: "Chosen" } } };
    expect(matches(`<hierarchy>${label()}${menu}</hierarchy>`, syntheticParent)).toHaveLength(0);
  });

  it("excludes the target itself when counting siblings", () => {
    const query = { type: "Label", withinParent: selector.withinParent };
    expect(matches(xml(row(label())), query)).toHaveLength(0);
    expect(matches(xml(row(label() + label())), query)).toHaveLength(2);
  });

  it("rejects malformed, recursive and index-based contexts", () => {
    for (const bad of [{}, { index: 1 }, { type: "Image", withinParent: {} },
      { ...selector, withinParent: { ...selector.withinParent, instance: 0 } },
      { ...selector, withinParent: { selector: { type: "Row" }, sibling: selector } },
      { ...selector, withinParent: { selector: {}, sibling: { text: "Chosen" } } }]) {
      expect(() => validateAndroidNodeSelector(bad)).toThrow();
    }
  });

  const hasXmllint = spawnSync("xmllint", ["--version"]).status === 0;
  it.skipIf(!hasXmllint)("evaluates the emitted XPath 1.0 with exact sibling/parent semantics and quote injection safety", () => {
    for (const source of [xml(row()), xml(row() + row()), xml(row(label() + menu + menu)),
      xml(row(label(), "Other") + row(menu)), xml(row(row(label()) + menu)), `<hierarchy>${menu}</hierarchy>`]) {
      const result = spawnSync("xmllint", ["--xpath", `count(${androidNodeSelectorXPath(selector)})`, "-"], { input: source, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(Number(result.stdout)).toBe(matches(source).length);
    }
    const text = `a'\" or @class='Image' or 'x'='x`;
    const query = { ...selector, withinParent: { selector: { type: "Row" }, sibling: { type: "Label", text } } };
    const source = xml(row(label(text.replaceAll('"', "&quot;").replaceAll("'", "&apos;")) + menu) + row(label("Unrelated") + menu));
    const result = spawnSync("xmllint", ["--xpath", `count(${androidNodeSelectorXPath(query)})`, "-"], { input: source, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(Number(result.stdout)).toBe(1);
    expect(matches(source, query)).toHaveLength(1);
  });

  function deviceFixture(source: string, elements: unknown[] = [{ ELEMENT: "chosen/id" }]) {
    const device = Object.create(NativeAndroidDevice.prototype) as NativeAndroidDevice;
    const request = vi.fn(async (_method: string, path: string) => path === "/elements" ? { value: elements } : {});
    const tap = vi.fn(async () => undefined);
    Object.assign(device, { sourceXml: async () => source, sessionRequest: request, tap });
    return { device, request, tap };
  }
  it("uses the scoped XPath in the real element route and clicks its id, not bounds", async () => {
    const { device, request, tap } = deviceFixture(xml(row()));
    await expect(device.tapUniqueNode(selector, { x: 10, y: 20 })).resolves.toBe("selector");
    expect(request.mock.calls[0]).toEqual(["POST", "/elements", { strategy: "xpath", selector: androidNodeSelectorXPath(selector) }]);
    expect(request.mock.calls[1]).toEqual(["POST", "/element/chosen%2Fid/click", {}]);
    expect(tap).not.toHaveBeenCalled();
  });
  it.each([{ elements: [] }, { elements: [{ ELEMENT: "a" }, { ELEMENT: "b" }] }])("fails closed if the second lookup becomes stale or ambiguous", async ({ elements }) => {
    const { device, request, tap } = deviceFixture(xml(row()), elements);
    await expect(device.tapUniqueNode(selector, { x: 10, y: 20 })).rejects.toThrow("live selector must match exactly one");
    expect(request).toHaveBeenCalledTimes(1);
    expect(tap).not.toHaveBeenCalled();
  });
  it("retains zero-match coordinate fallback, never an unrelated element", async () => {
    const { device, request, tap } = deviceFixture(xml(row(menu)));
    await expect(device.tapUniqueNode(selector, { x: 10, y: 20 })).resolves.toBe("coordinate-fallback");
    expect(request).not.toHaveBeenCalled();
    expect(tap).toHaveBeenCalledWith({ x: 10, y: 20 });
  });
  it.each([xml(row() + row()), xml(row(label() + menu + menu)), xml(row(label() + label() + menu))])("never falls back on source ambiguity", async source => {
    const { device, request, tap } = deviceFixture(source);
    await expect(device.tapUniqueNode(selector, { x: 10, y: 20 })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(tap).not.toHaveBeenCalled();
  });
  it("preserves relational fields through replay primitive parsing", async () => {
    const tapUniqueNode = vi.fn();
    await replayAndroidPrimitive({ invalidateObservation: vi.fn(), device: { tapUniqueNode } } as never,
      { operation: "tapUniqueNode", arguments: [selector] });
    expect(tapUniqueNode).toHaveBeenCalledWith(selector, undefined);
  });
});

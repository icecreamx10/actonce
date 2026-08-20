import { describe, expect, it } from "vitest";
import type { CdpClient } from "../src/index.js";
import { CdpTreeSession, matchSemanticProjection, normalizeCdpNode } from "../src/index.js";

describe("CDP tree observer", () => {
  it("normalizes Lynx test tags and ignores runtime node ids in the hash", async () => {
    let nodeId = 1;
    const client: CdpClient = {
      request: async () => ({ root: { nodeId: nodeId++, backendNodeId: nodeId++, nodeName: "DIV", localName: "div", attributes: ["lynx-test-tag", "count"], children: [{ nodeType: 3, nodeName: "#text", nodeValue: "  1  " }] } }) as never,
      close: async () => {},
    };
    const session = new CdpTreeSession(client, "target");
    const first = await session.capture();
    const second = await session.capture();
    expect(first.root.testId).toBe("count");
    expect(first.root.text).toBe("1");
    expect(first.root.children[0]?.text).toBe("1");
    expect(first.canonicalHash).toBe(second.canonicalHash);
  });

  it("matches the normalized descendant text of a tagged element", () => {
    const root = normalizeCdpNode({
      nodeName: "DIV",
      localName: "div",
      attributes: ["lynx-test-tag", "count"],
      children: [{ nodeType: 3, nodeName: "#text", nodeValue: "  1  " }],
    });
    const differences = matchSemanticProjection([
      { selector: { testId: "count" }, properties: { text: "1" } },
    ])({
      snapshotId: "one", source: { id: "cdp", kind: "cdp", schemaVersion: "1", capabilities: { fullTree: true, query: true, bounds: false, stableNodeId: false, subscriptions: false } }, targetId: "target", sequence: 1, capturedAtMonotonicNs: "1", captureDurationMs: 1, root, canonicalHash: "hash",
    });
    expect(differences).toEqual([]);
  });

  it("matches semantic projections independently of the source node id", () => {
    const root = normalizeCdpNode({ nodeName: "BUTTON", localName: "button", backendNodeId: 42, attributes: ["data-testid", "save", "aria-label", "Save"] });
    const differences = matchSemanticProjection([{ selector: { testId: "save" }, properties: { enabled: undefined } }])({
      snapshotId: "one", source: { id: "cdp", kind: "cdp", schemaVersion: "1", capabilities: { fullTree: true, query: true, bounds: false, stableNodeId: false, subscriptions: false } }, targetId: "target", sequence: 1, capturedAtMonotonicNs: "1", captureDurationMs: 1, root, canonicalHash: "hash",
    });
    expect(differences).toEqual([]);
  });
});

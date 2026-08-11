import { describe, expect, it } from "vitest";
import {
  findNodeCenterByDescription,
  findNodeCenterByText,
} from "../benchmark/android/markor-fixture.js";

describe("findNodeCenterByDescription", () => {
  it("returns the center of an accessibility target", () => {
    const xml = `
      <hierarchy>
        <node text="" content-desc="NEXT" clickable="true" bounds="[922,2245][1048,2371]" />
      </hierarchy>
    `;

    expect(findNodeCenterByDescription(xml, "NEXT")).toEqual({
      x: 985,
      y: 2308,
    });
  });

  it("returns undefined when the target is absent", () => {
    expect(findNodeCenterByDescription("<hierarchy />", "DONE")).toBeUndefined();
  });

  it("finds a button exposed through text instead of content description", () => {
    const xml = '<node text="DONE" content-desc="" bounds="[922,2242][1048,2368]" />';

    expect(findNodeCenterByText(xml, "DONE")).toEqual({ x: 985, y: 2305 });
  });
});

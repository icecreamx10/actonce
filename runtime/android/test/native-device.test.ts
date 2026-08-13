import { describe, expect, it } from "vitest";
import { normalizeAndroidSource } from "../src/native-device.js";

describe("normalizeAndroidSource", () => {
  it("preserves accessibility attributes used by source checkpoints", () => {
    const source = normalizeAndroidSource(`<?xml version="1.0"?><hierarchy><node text="Products" content-desc="Increase item quantity"><node text="3" /></node></hierarchy>`);
    expect(source).toContain("Products");
    expect(source).toContain("Increase item quantity");
    expect(source).toContain('"text":"3"');
  });
});

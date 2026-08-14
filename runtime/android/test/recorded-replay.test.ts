import { describe, expect, it } from "vitest";
import { matchesSourceExpectation } from "../src/recorded-replay.js";

describe("recorded replay source checkpoints", () => {
  const source = JSON.stringify({
    children: [
      { text: "Home", focused: "false" },
      { text: "First name", focused: "true" },
    ],
  });

  it("does not let broad string evidence override a precise node mismatch", () => {
    expect(matchesSourceExpectation(source, {
      sequence: 1,
      referencePath: "unused.png",
      sourceIncludes: ["Home"],
      sourceNode: { text: "Li", focused: "true" },
    })).toBe(false);
  });

  it("lets a precise node take precedence over noisy broad string evidence", () => {
    expect(matchesSourceExpectation(source, {
      sequence: 1,
      referencePath: "unused.png",
      sourceIncludes: ["Missing broad label"],
      sourceNode: { text: "First name", focused: "true" },
    })).toBe(true);
  });

  it("supports checkpoints that intentionally contain only one evidence form", () => {
    expect(matchesSourceExpectation(source, {
      sequence: 1,
      referencePath: "unused.png",
      sourceIncludes: ["Home"],
    })).toBe(true);
    expect(matchesSourceExpectation(source, {
      sequence: 1,
      referencePath: "unused.png",
      sourceNode: { text: "First name", focused: "true" },
    })).toBe(true);
  });
});

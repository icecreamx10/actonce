import type {
  CheckpointDifference,
  CheckpointDriver,
  CheckpointResult,
  CheckpointSpec,
  CheckpointVerificationContext,
  FallbackDriver,
  FallbackPolicy,
  ReplayEvent,
} from "@actonce/replay";
import { ReplayFlow } from "@actonce/replay";
import { locatorToWebdriver } from "./locator.js";
import type { MacSession } from "./session.js";
import type { MacLocator } from "./types.js";

export type MacTextExpectation = {
  equals?: string;
  includes?: string;
  matches?: string;
};

export type MacElementExpectation = {
  id: string;
  locator: MacLocator;
  exists?: boolean;
  displayed?: boolean;
  enabled?: boolean;
  selected?: boolean;
  text?: MacTextExpectation;
};

export type MacCheckpointExpectation = {
  source?: {
    includes?: string[];
    excludes?: string[];
  };
  elements?: MacElementExpectation[];
  apps?: Array<{
    bundleId: string;
    state: number;
  }>;
  captureScreenshot?: boolean;
  visual?: MacVisualExpectation;
};

export type MacVisualExpectation = {
  referencePath: string;
  region?: { left: number; top: number; width: number; height: number };
  resizeWidth?: number;
  pixelThreshold?: number;
  maxDifferenceRatio?: number;
};

export type MacVisualComparison = {
  referencePath: string;
  differenceRatio: number;
  meanAbsoluteDifference: number;
  width: number;
  height: number;
};

export type MacElementSnapshot = {
  id: string;
  exists: boolean;
  displayed?: boolean;
  enabled?: boolean;
  selected?: boolean;
  text?: string;
  error?: string;
};

export type MacCheckpointActual = {
  source?: string;
  elements: MacElementSnapshot[];
  apps: Array<{ bundleId: string; state?: number; error?: string }>;
  screenshotBase64?: string;
  visual?: MacVisualComparison;
  captureErrors: string[];
};

export type MacReplayFlowOptions = {
  policy?: FallbackPolicy;
  fallback?: FallbackDriver<MacCheckpointExpectation, MacCheckpointActual>;
  emit?: (event: ReplayEvent<MacCheckpointActual>) => void | Promise<void>;
};

export type MacFallbackPlugin = {
  driver: FallbackDriver<MacCheckpointExpectation, MacCheckpointActual>;
  close?: () => Promise<void> | void;
};

export type MacFallbackPluginModule = {
  createFallback: () => Promise<MacFallbackPlugin> | MacFallbackPlugin;
};

export function createMacReplayFlow(
  mac: MacSession,
  options: MacReplayFlowOptions = {},
): ReplayFlow<MacCheckpointExpectation, MacCheckpointActual> {
  return new ReplayFlow({
    checkpoints: new MacCheckpointDriver(mac),
    policy: options.policy,
    fallback: options.fallback,
    emit: options.emit,
  });
}

export class MacCheckpointDriver implements CheckpointDriver<MacCheckpointExpectation, MacCheckpointActual> {
  constructor(private readonly mac: MacSession) {}

  async verify(
    spec: CheckpointSpec<MacCheckpointExpectation>,
    context?: CheckpointVerificationContext,
  ): Promise<CheckpointResult<MacCheckpointActual>> {
    const actual = await this.capture(spec.expected, context);
    const differences = compareMacCheckpoint(spec.expected, actual);
    return {
      status: actual.captureErrors.length ? "unknown" : differences.length ? "mismatched" : "matched",
      actual,
      differences,
    };
  }

  private async capture(
    expected: MacCheckpointExpectation,
    context?: CheckpointVerificationContext,
  ): Promise<MacCheckpointActual> {
    const actual: MacCheckpointActual = { elements: [], apps: [], captureErrors: [] };
    if (context?.signal.aborted) {
      actual.captureErrors.push("checkpoint deadline exceeded before capture");
      return actual;
    }
    if (expected.source) {
      try {
        actual.source = await this.mac.source();
      } catch (error) {
        actual.captureErrors.push(`source: ${errorMessage(error)}`);
      }
    }
    for (const expectation of expected.elements ?? []) {
      const snapshot = await this.captureElement(expectation);
      actual.elements.push(snapshot);
      if (snapshot.error) actual.captureErrors.push(`element ${expectation.id}: ${snapshot.error}`);
    }
    for (const app of expected.apps ?? []) {
      try {
        actual.apps.push({ bundleId: app.bundleId, state: await this.mac.queryAppState(app.bundleId) });
      } catch (error) {
        actual.apps.push({ bundleId: app.bundleId, error: errorMessage(error) });
        actual.captureErrors.push(`app ${app.bundleId}: ${errorMessage(error)}`);
      }
    }
    if (expected.captureScreenshot || expected.visual) {
      try {
        actual.screenshotBase64 = await this.mac.screenshot();
        if (context?.signal.aborted || Date.now() > (context?.deadlineMs ?? Infinity)) {
          actual.captureErrors.push("checkpoint deadline exceeded during screenshot capture");
          return actual;
        }
        if (expected.visual) {
          actual.visual = await compareVisualScreenshot(actual.screenshotBase64, expected.visual);
        }
      } catch (error) {
        actual.captureErrors.push(`screenshot: ${errorMessage(error)}`);
      }
    }
    return actual;
  }

  private async captureElement(expected: MacElementExpectation): Promise<MacElementSnapshot> {
    try {
      const element = await this.mac.driver.$(locatorToWebdriver(expected.locator));
      const exists = await element.isExisting();
      if (!exists) return { id: expected.id, exists: false };
      const snapshot: MacElementSnapshot = { id: expected.id, exists: true };
      if (expected.displayed !== undefined) snapshot.displayed = await element.isDisplayed();
      if (expected.enabled !== undefined) snapshot.enabled = await element.isEnabled();
      if (expected.selected !== undefined) snapshot.selected = await element.isSelected();
      if (expected.text) snapshot.text = await element.getText();
      return snapshot;
    } catch (error) {
      return { id: expected.id, exists: false, error: errorMessage(error) };
    }
  }
}

export function compareMacCheckpoint(
  expected: MacCheckpointExpectation,
  actual: MacCheckpointActual,
): CheckpointDifference[] {
  const differences: CheckpointDifference[] = [];
  for (const value of expected.source?.includes ?? []) {
    if (!actual.source?.includes(value)) difference(differences, "source", `includes ${value}`, actual.source, `AX source does not include ${JSON.stringify(value)}`);
  }
  for (const value of expected.source?.excludes ?? []) {
    if (actual.source?.includes(value)) difference(differences, "source", `excludes ${value}`, actual.source, `AX source unexpectedly includes ${JSON.stringify(value)}`);
  }
  for (const elementExpected of expected.elements ?? []) {
    const path = `elements.${elementExpected.id}`;
    const elementActual = actual.elements.find((entry) => entry.id === elementExpected.id);
    if (!elementActual) {
      difference(differences, path, elementExpected, undefined, "Element was not captured");
      continue;
    }
    const shouldExist = elementExpected.exists ?? true;
    if (elementActual.exists !== shouldExist) {
      difference(differences, `${path}.exists`, shouldExist, elementActual.exists, "Element existence differs");
      continue;
    }
    if (!shouldExist) continue;
    compareValue(differences, `${path}.displayed`, elementExpected.displayed, elementActual.displayed);
    compareValue(differences, `${path}.enabled`, elementExpected.enabled, elementActual.enabled);
    compareValue(differences, `${path}.selected`, elementExpected.selected, elementActual.selected);
    compareText(differences, `${path}.text`, elementExpected.text, elementActual.text);
  }
  for (const appExpected of expected.apps ?? []) {
    const appActual = actual.apps.find((entry) => entry.bundleId === appExpected.bundleId);
    compareValue(differences, `apps.${appExpected.bundleId}.state`, appExpected.state, appActual?.state);
  }
  if (expected.visual) {
    if (!actual.visual) {
      difference(differences, "visual", expected.visual, undefined, "Visual checkpoint was not compared");
    } else {
      const maximum = expected.visual.maxDifferenceRatio ?? 0.03;
      if (actual.visual.differenceRatio > maximum) {
        difference(
          differences,
          "visual.differenceRatio",
          { maximum },
          actual.visual,
          `Screenshot difference ratio ${actual.visual.differenceRatio.toFixed(4)} exceeds ${maximum}`,
        );
      }
    }
  }
  return differences;
}

export async function compareVisualScreenshot(
  actualScreenshotBase64: string,
  expected: MacVisualExpectation,
): Promise<MacVisualComparison> {
  const { default: sharp } = await import("sharp");
  const resizeWidth = positiveInteger(expected.resizeWidth ?? 256, "visual resizeWidth");
  const pixelThreshold = boundedByte(expected.pixelThreshold ?? 16, "visual pixelThreshold");
  const maximum = expected.maxDifferenceRatio ?? 0.03;
  if (!Number.isFinite(maximum) || maximum < 0 || maximum > 1) {
    throw new Error("visual maxDifferenceRatio must be between 0 and 1");
  }
  const reference = expected.region
    ? sharp(expected.referencePath).extract(expected.region)
    : sharp(expected.referencePath);
  const metadata = await reference.clone().metadata();
  if (!metadata.width || !metadata.height) throw new Error("Visual reference has no dimensions");
  const height = Math.max(1, Math.round(resizeWidth * metadata.height / metadata.width));
  const actual = expected.region
    ? sharp(Buffer.from(actualScreenshotBase64, "base64")).extract(expected.region)
    : sharp(Buffer.from(actualScreenshotBase64, "base64"));
  const [expectedPixels, actualPixels] = await Promise.all([
    reference.resize(resizeWidth, height, { fit: "fill" }).greyscale().raw().toBuffer(),
    actual.resize(resizeWidth, height, { fit: "fill" }).greyscale().raw().toBuffer(),
  ]);
  if (expectedPixels.length !== actualPixels.length || expectedPixels.length === 0) {
    throw new Error("Visual checkpoint produced incompatible pixel buffers");
  }
  let differing = 0;
  let absoluteDifference = 0;
  for (let index = 0; index < expectedPixels.length; index += 1) {
    const delta = Math.abs(expectedPixels[index] - actualPixels[index]);
    absoluteDifference += delta;
    if (delta > pixelThreshold) differing += 1;
  }
  return {
    referencePath: expected.referencePath,
    differenceRatio: differing / expectedPixels.length,
    meanAbsoluteDifference: absoluteDifference / expectedPixels.length,
    width: resizeWidth,
    height,
  };
}

function compareText(
  differences: CheckpointDifference[],
  path: string,
  expected: MacTextExpectation | undefined,
  actual: string | undefined,
): void {
  if (!expected) return;
  if (expected.equals !== undefined && actual !== expected.equals) {
    difference(differences, path, expected, actual, "Element text is not equal");
  }
  if (expected.includes !== undefined && !actual?.includes(expected.includes)) {
    difference(differences, path, expected, actual, "Element text does not include expected text");
  }
  if (expected.matches !== undefined) {
    try {
      if (!new RegExp(expected.matches).test(actual ?? "")) {
        difference(differences, path, expected, actual, "Element text does not match expected pattern");
      }
    } catch {
      difference(differences, path, expected, actual, "Expected text pattern is invalid");
    }
  }
}

function compareValue(
  differences: CheckpointDifference[],
  path: string,
  expected: unknown,
  actual: unknown,
): void {
  if (expected !== undefined && actual !== expected) {
    difference(differences, path, expected, actual, `${path} differs`);
  }
}

function difference(
  differences: CheckpointDifference[],
  path: string,
  expected: unknown,
  actual: unknown,
  message: string,
): void {
  differences.push({ path, expected, actual, message });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function boundedByte(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`${name} must be between 0 and 255`);
  return value;
}

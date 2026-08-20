#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { CdpTreeObserver, matchCanonicalTree } from "@byted-lynx/actonce-cdp";
import { MacDeviceConnector } from "@byted-lynx/actonce-macos";
import type { VisualCaptureCapability } from "@byted-lynx/actonce-replay";

const options = parseArgs(process.argv.slice(2));
const endpoint = required(options, "--cdp-endpoint");
const bundleId = required(options, "--bundle-id");
const samples = positiveInteger(options.get("--samples") ?? "20", "--samples");
const visualSamples = positiveInteger(options.get("--visual-samples") ?? "10", "--visual-samples");
const artifactDirectory = await mkdtemp(resolve(tmpdir(), "actonce-checkpoint-bench-"));
const device = await new MacDeviceConnector().connect();

try {
  const target = await device.resolveTarget({
    bundleId,
    titlePattern: options.get("--window-title-pattern"),
  });
  const tree = await new CdpTreeObserver().connect({
    device,
    target,
    options: {
      endpoint,
      target: options.get("--cdp-title") ? { title: options.get("--cdp-title") } : undefined,
    },
  });
  const visualCapability = await device.getCapability<VisualCaptureCapability>("visualCapture");
  const visual = await visualCapability.openStream({ target, artifactDirectory });
  try {
    const baseline = await tree.capture();
    const matchTree = matchCanonicalTree(baseline.canonicalHash);
    const treeCaptureMs: number[] = [];
    const treeMatchMs: number[] = [];
    const treePollMs: number[] = [];
    for (let index = 0; index < samples; index += 1) {
      const totalStarted = performance.now();
      const snapshot = await tree.capture();
      treeCaptureMs.push(snapshot.captureDurationMs);
      const matchStarted = performance.now();
      const differences = matchTree(snapshot);
      treeMatchMs.push(performance.now() - matchStarted);
      treePollMs.push(performance.now() - totalStarted);
      if (differences.length) throw new Error(`CDP tree changed during benchmark sample ${index + 1}`);
    }

    // The first capture initializes ScreenCaptureKit and is deliberately
    // reported separately from steady-state checkpoint cost.
    const coldStarted = performance.now();
    const seed = await visual.capture({ persist: true });
    const coldCaptureMs = performance.now() - coldStarted;
    if (!seed.artifactRef) throw new Error("Persisted seed frame has no artifactRef");
    const reference = await visual.registerReference({ path: seed.artifactRef });
    const visualCaptureMs: number[] = [];
    const visualCompareMs: number[] = [];
    const visualCheckpointMs: number[] = [];
    for (let index = 0; index < visualSamples; index += 1) {
      const totalStarted = performance.now();
      const captureStarted = performance.now();
      const frame = await visual.capture();
      visualCaptureMs.push(performance.now() - captureStarted);
      const comparison = await visual.compare({
        frameId: frame.frameId,
        referenceId: reference.referenceId,
        comparator: { type: "pixelDiff", mismatchThreshold: 0.001, channelTolerance: 8 },
      });
      visualCompareMs.push(comparison.metrics.compareDurationMs);
      visualCheckpointMs.push(performance.now() - totalStarted);
      if (!comparison.matched) throw new Error(`Visual checkpoint changed during sample ${index + 1}`);
    }

    const treePoll = statistics(treePollMs);
    const visualCheckpoint = statistics(visualCheckpointMs);
    console.log(JSON.stringify({
      schemaVersion: 1,
      samples: { tree: samples, visual: visualSamples },
      target: { bundleId, window: target.window, pixels: [seed.widthPx, seed.heightPx] },
      tree: {
        captureAndCanonicalizeMs: statistics(treeCaptureMs),
        semanticMatchMs: statistics(treeMatchMs),
        pollTotalMs: treePoll,
      },
      visual: {
        coldCaptureMs,
        warmCaptureMs: statistics(visualCaptureMs),
        pixelCompareMs: statistics(visualCompareMs),
        checkpointTotalMs: visualCheckpoint,
      },
      medianVisualToTreeRatio: visualCheckpoint.median / treePoll.median,
    }, null, 2));
  } finally {
    await Promise.allSettled([tree.close(), visual.close()]);
  }
} finally {
  await device.close();
  await rm(artifactDirectory, { recursive: true, force: true });
}

function parseArgs(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    result.set(key, value);
  }
  return result;
}

function required(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function positiveInteger(value: string, key: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${key} must be a positive integer`);
  return parsed;
}

function statistics(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number) => sorted[Math.floor((sorted.length - 1) * fraction)]!;
  return {
    minimum: sorted[0]!,
    median: percentile(0.5),
    p95: percentile(0.95),
    maximum: sorted.at(-1)!,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

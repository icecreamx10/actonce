import type {
  DeviceTarget,
  VisualComparator,
  VisualCompareResult,
  VisualFrame,
  VisualRegion,
} from "@byted-lynx/actonce-replay";

export type CaptureServiceRequest = {
  id: string;
  method:
    | "health"
    | "targets"
    | "session.open"
    | "session.close"
    | "capture"
    | "reference.register"
    | "compare"
    | "waitStable";
  params?: Record<string, unknown>;
};

export type CaptureServiceResponse = {
  id: string;
  result?: unknown;
  error?: { code: string; message: string };
};

export type OpenVisualSession = {
  sessionId: string;
  target: DeviceTarget;
};

export type CaptureParams = {
  sessionId: string;
  region?: VisualRegion;
  persist?: boolean;
};

export type RegisterReferenceParams = {
  sessionId: string;
  path: string;
  region?: VisualRegion;
};

export type CompareParams = {
  sessionId: string;
  frameId: string;
  referenceId: string;
  region?: VisualRegion;
  comparator: VisualComparator;
};

export type WaitStableParams = {
  sessionId: string;
  region?: VisualRegion;
  comparator?: VisualComparator;
  consecutiveFrames?: number;
  timeoutMs: number;
  minimumObservationMs?: number;
};

export type CaptureBackendTarget = {
  targetId: string;
  windowId: number;
  pid: number;
  bundleId: string;
  processName: string;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
};

export type CaptureBackendFrame = {
  png: Buffer;
  widthPx: number;
  heightPx: number;
  scaleFactor: number;
};

export interface MacCaptureBackend {
  targets(): Promise<CaptureBackendTarget[]>;
  capture(windowId: number): Promise<CaptureBackendFrame>;
  close(): Promise<void>;
}

export type CaptureResult = VisualFrame;
export type CompareResult = VisualCompareResult;

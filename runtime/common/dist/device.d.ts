export type DevicePlatform = "macos" | "ios" | "android" | "windows";
export type DeviceIdentity = {
    platform: DevicePlatform;
    deviceId: string;
    name?: string;
    osVersion?: string;
    architecture?: string;
    isSimulator?: boolean;
};
export type DeviceRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type DeviceTarget = {
    targetId: string;
    deviceId: string;
    app: {
        pid?: number;
        bundleId?: string;
        packageName?: string;
        processName?: string;
    };
    window?: {
        windowId?: string;
        title?: string;
        bounds: DeviceRect;
        scaleFactor: number;
    };
};
export type TargetSelector = {
    targetId?: string;
    pid?: number;
    bundleId?: string;
    processName?: string;
    windowId?: string;
    titlePattern?: string;
};
export type DeviceCapabilityKind = "visualCapture" | "input";
export interface DeviceCapability {
    readonly kind: DeviceCapabilityKind;
}
export type DeviceCapabilities = Readonly<Record<DeviceCapabilityKind, boolean>>;
export interface DeviceSession {
    readonly identity: DeviceIdentity;
    readonly capabilities: DeviceCapabilities;
    listTargets(): Promise<DeviceTarget[]>;
    resolveTarget(selector: TargetSelector): Promise<DeviceTarget>;
    getCapability<T extends DeviceCapability>(kind: T["kind"]): Promise<T>;
    close(): Promise<void>;
}
export interface DeviceConnector<TOptions = unknown> {
    readonly platform: DevicePlatform;
    connect(options: TOptions): Promise<DeviceSession>;
}
export type VisualRegion = DeviceRect & {
    space: "targetLogical";
};
export type VisualComparator = {
    type: "pixelDiff";
    mismatchThreshold: number;
    channelTolerance?: number;
};
export type VisualFrame = {
    frameId: string;
    sequence: number;
    capturedAtMonotonicNs: string;
    capturedAtWallTime: string;
    widthPx: number;
    heightPx: number;
    scaleFactor: number;
    targetId: string;
    artifactRef?: string;
};
export type VisualCompareResult = {
    matched: boolean;
    differenceRatio?: number;
    meanAbsoluteDifference?: number;
    hashDistance?: number;
    actualFrameId: string;
    referenceId: string;
    metrics: {
        captureDurationMs: number;
        compareDurationMs: number;
        totalDurationMs: number;
    };
};
export interface VisualCaptureSession {
    capture(options?: {
        region?: VisualRegion;
        persist?: boolean;
    }): Promise<VisualFrame>;
    registerReference(options: {
        path: string;
        region?: VisualRegion;
    }): Promise<{
        referenceId: string;
        widthPx: number;
        heightPx: number;
    }>;
    compare(options: {
        frameId: string;
        referenceId: string;
        region?: VisualRegion;
        comparator: VisualComparator;
    }): Promise<VisualCompareResult>;
    waitStable(options: {
        region?: VisualRegion;
        comparator?: VisualComparator;
        consecutiveFrames?: number;
        timeoutMs: number;
        minimumObservationMs?: number;
    }): Promise<{
        status: "stable" | "timeout";
        finalFrame: VisualFrame;
        frameCount: number;
        settleDelayMs: number;
        metrics: {
            captureDurationMs: number;
            compareDurationMs: number;
            settleDelayMs: number;
            totalDurationMs: number;
        };
    }>;
    close(): Promise<void>;
}
export interface VisualCaptureCapability extends DeviceCapability {
    readonly kind: "visualCapture";
    openStream(options: {
        target: DeviceTarget;
        fps?: number;
        bufferFrames?: number;
        artifactDirectory?: string;
    }): Promise<VisualCaptureSession>;
}
//# sourceMappingURL=device.d.ts.map
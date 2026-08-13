import type {
  EventCorrelation,
  RecorderContext,
  RecorderInterceptor,
  SourceDescriptor,
} from "../../core/source-interceptor.js";

export type MacOSAXNotification = {
  name: string;
  pid?: number;
  element?: unknown;
  attributes?: Record<string, unknown>;
  observedMonotonicNs?: string;
};

/** Adapter boundary for a native AX implementation (Swift helper, addon, etc.). */
export interface MacOSAXProvider {
  start?(listener: (notification: MacOSAXNotification) => void): Promise<void> | void;
  stop?(): Promise<void> | void;
  snapshot(): Promise<unknown>;
}

/** Records AX notifications and content-addressed accessibility snapshots. */
export class MacOSAXInterceptor implements RecorderInterceptor {
  readonly source: SourceDescriptor = {
    type: "macos-ax",
    instanceId: "macos-accessibility",
  };

  private context?: RecorderContext;

  constructor(private readonly provider: MacOSAXProvider) {}

  async start(context: RecorderContext): Promise<void> {
    this.context = context;
    await this.provider.start?.((notification) => {
      context.emit({
        kind: "ax.notification.received",
        lifecycle: "instant",
        origin: "macos-accessibility",
        notification: {
          name: notification.name,
          pid: notification.pid,
          element: notification.element,
          attributes: notification.attributes,
        },
        observedMonotonicNs: notification.observedMonotonicNs,
      });
    });
  }

  async captureSnapshot(
    trigger: string,
    correlation?: EventCorrelation,
  ): Promise<{ artifact: ReturnType<RecorderContext["storeArtifact"]> }> {
    if (!this.context) throw new Error("macOS AX interceptor is not started");
    const snapshot = await this.provider.snapshot();
    const artifact = this.context.storeArtifact(
      Buffer.from(JSON.stringify(snapshot), "utf8"),
      "application/json",
    );
    this.context.emit({
      kind: "ax.snapshot.captured",
      lifecycle: "instant",
      origin: "macos-accessibility",
      trigger,
      artifact,
      correlation,
    });
    return { artifact };
  }

  async stop(): Promise<void> {
    await this.provider.stop?.();
    this.context = undefined;
  }
}

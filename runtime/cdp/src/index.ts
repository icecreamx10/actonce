import { randomUUID } from "node:crypto";
import type {
  CheckpointDifference,
  CheckpointDriver,
  CheckpointResult,
  CheckpointSpec,
  CheckpointVerificationContext,
  DeviceSession,
  DeviceTarget,
  FallbackDriver,
  FallbackPolicy,
  ObservationCheckpointActual,
  ObservationVisualExpectation,
  ReplayEvent,
  SemanticNode,
  SemanticSelector,
  TreeObservationSession,
  TreeMatcher,
  TreeObserver,
  TreeSnapshot,
  TreeSourceDescriptor,
} from "@byted-lynx/actonce-replay";
import {
  canonicalTreeHash,
  ObservationCheckpointDriver,
  ReplayFlow,
} from "@byted-lynx/actonce-replay";
import type { VisualCaptureSession } from "@byted-lynx/actonce-replay";

export interface CdpClient {
  request<TResult = unknown>(method: string, params?: Record<string, unknown>): Promise<TResult>;
  close(): Promise<void>;
}

export type CdpObserverOptions = {
  client?: CdpClient;
  endpoint?: string;
  target?: { id?: string; title?: string; url?: string; type?: string };
};

type CdpNode = {
  nodeId?: number;
  backendNodeId?: number;
  nodeType?: number;
  nodeName?: string;
  localName?: string;
  nodeValue?: string;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  contentDocument?: CdpNode;
  pseudoElements?: CdpNode[];
};

type CdpDocumentResponse = { root: CdpNode };

export const CDP_TREE_SOURCE: TreeSourceDescriptor = {
  id: "cdp-dom",
  kind: "cdp",
  schemaVersion: "1",
  capabilities: {
    fullTree: true,
    query: true,
    bounds: false,
    stableNodeId: false,
    subscriptions: false,
  },
};

export class CdpTreeObserver implements TreeObserver<CdpObserverOptions> {
  readonly source = CDP_TREE_SOURCE;

  async connect(context: {
    device: DeviceSession;
    target: DeviceTarget;
    options: CdpObserverOptions;
  }): Promise<TreeObservationSession> {
    const client = context.options.client ?? await CdpWebSocketClient.connect(
      await resolveCdpWebSocketUrl(context.options.endpoint, context.options.target),
    );
    await client.request("DOM.enable");
    return new CdpTreeSession(client, context.target.targetId);
  }
}

export class CdpTreeSession implements TreeObservationSession {
  readonly source = CDP_TREE_SOURCE;
  private sequence = 0;

  constructor(
    private readonly client: CdpClient,
    private readonly targetId: string,
  ) {}

  async capture(): Promise<TreeSnapshot> {
    const started = performance.now();
    const response = await this.client.request<CdpDocumentResponse>("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    const root = normalizeCdpNode(response.root);
    this.sequence += 1;
    return {
      snapshotId: randomUUID(),
      source: this.source,
      targetId: this.targetId,
      sequence: this.sequence,
      capturedAtMonotonicNs: process.hrtime.bigint().toString(),
      captureDurationMs: performance.now() - started,
      root,
      canonicalHash: canonicalTreeHash(root),
    };
  }

  async query(selector: SemanticSelector): Promise<SemanticNode[]> {
    const snapshot = await this.capture();
    const matches: SemanticNode[] = [];
    visit(snapshot.root, (node) => {
      if (matchesSelector(node, selector)) matches.push(node);
    });
    return matches;
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

export function normalizeCdpNode(node: CdpNode): SemanticNode {
  const attributes = attributeMap(node.attributes ?? []);
  const children = [
    ...(node.children ?? []),
    ...(node.shadowRoots ?? []),
    ...(node.contentDocument ? [node.contentDocument] : []),
    ...(node.pseudoElements ?? []),
  ].map(normalizeCdpNode);
  const nodeName = (node.localName || node.nodeName || "unknown").toLowerCase();
  const text = node.nodeType === 3
    ? normalizeText(node.nodeValue)
    : normalizeText(descendantText(children));
  return compact({
    nodeId: node.backendNodeId === undefined ? undefined : String(node.backendNodeId),
    role: attributes.role ?? semanticRole(nodeName),
    name: attributes["aria-label"] ?? attributes.name ?? attributes.title,
    text,
    value: attributes.value,
    testId: attributes["lynx-test-tag"] ?? attributes["data-testid"] ?? attributes["data-test-id"],
    className: attributes.class,
    states: compact({
      visible: attributes.hidden === undefined && attributes["aria-hidden"] !== "true" ? undefined : false,
      enabled: attributes.disabled === undefined && attributes["aria-disabled"] !== "true" ? undefined : false,
      focused: attributes["data-actonce-focused"] === undefined ? undefined : attributes["data-actonce-focused"] === "true",
      selected: booleanAttribute(attributes, "aria-selected"),
      checked: booleanAttribute(attributes, "aria-checked"),
    }),
    attributes: Object.fromEntries(Object.entries(attributes).sort(([left], [right]) => left.localeCompare(right))),
    sourceAttributes: compact({ nodeType: node.nodeType, nodeName: node.nodeName }),
    children,
  }) as SemanticNode;
}

function descendantText(children: SemanticNode[]): string | undefined {
  const parts: string[] = [];
  visitText(children, parts);
  return parts.join(" ") || undefined;
}

function visitText(nodes: SemanticNode[], parts: string[]): void {
  for (const node of nodes) {
    if (node.text && node.role === "#text") parts.push(node.text);
    else visitText(node.children, parts);
  }
}

export function matchCanonicalTree(expectedHash: string) {
  return (snapshot: TreeSnapshot): CheckpointDifference[] => snapshot.canonicalHash === expectedHash
    ? []
    : [{
        path: "tree.canonicalHash",
        expected: expectedHash,
        actual: snapshot.canonicalHash,
        message: "Canonical CDP tree differs",
      }];
}

export type SemanticProjection = Array<{
  selector: SemanticSelector;
  count?: { min?: number; max?: number };
  properties?: {
    text?: string;
    value?: string;
    visible?: boolean;
    enabled?: boolean;
  };
}>;

export type CdpCheckpointExpectation = {
  tree: {
    canonicalHash?: string;
    projection?: SemanticProjection;
  };
  visual?: ObservationVisualExpectation;
};

export type CdpCheckpointActual = ObservationCheckpointActual;

export type CdpCheckpointDriverOptions = {
  tree: TreeObservationSession;
  visual?: VisualCaptureSession;
  semanticMatchesBeforeVisual?: number;
  now?: () => number;
};

export type CdpReplayFlowOptions = CdpCheckpointDriverOptions & {
  policy?: FallbackPolicy;
  fallback?: FallbackDriver<CdpCheckpointExpectation, CdpCheckpointActual>;
  emit?: (event: ReplayEvent<CdpCheckpointActual>) => void | Promise<void>;
  delay?: (durationMs: number) => Promise<void>;
};

export function createCdpReplayFlow(options: CdpReplayFlowOptions) {
  return new ReplayFlow<CdpCheckpointExpectation, CdpCheckpointActual>({
    checkpoints: new CdpCheckpointDriver(options),
    policy: options.policy,
    fallback: options.fallback,
    emit: options.emit,
    now: options.now,
    delay: options.delay,
  });
}

/** CDP lowering for the shared ActOnce observation checkpoint driver. */
export class CdpCheckpointDriver
implements CheckpointDriver<CdpCheckpointExpectation, CdpCheckpointActual> {
  private readonly driver: ObservationCheckpointDriver<CdpCheckpointExpectation>;

  constructor(options: CdpCheckpointDriverOptions) {
    this.driver = new ObservationCheckpointDriver({
      tree: options.tree,
      matcher: (expected) => matchCdpCheckpoint(expected.tree),
      visual: options.visual ? {
        session: options.visual,
        expectation: (expected) => expected.visual,
      } : undefined,
      semanticMatchesBeforeVisual: options.semanticMatchesBeforeVisual,
      now: options.now,
    });
  }

  verify(
    spec: CheckpointSpec<CdpCheckpointExpectation>,
    context?: CheckpointVerificationContext,
  ): Promise<CheckpointResult<CdpCheckpointActual>> {
    return this.driver.verify(spec, context);
  }
}

export function matchCdpCheckpoint(expected: CdpCheckpointExpectation["tree"]): TreeMatcher {
  if (!expected.canonicalHash && !expected.projection) {
    throw new TypeError("CDP checkpoint requires canonicalHash or semantic projection");
  }
  const matchers: TreeMatcher[] = [];
  if (expected.canonicalHash) matchers.push(matchCanonicalTree(expected.canonicalHash));
  if (expected.projection) matchers.push(matchSemanticProjection(expected.projection));
  return async (snapshot) => (await Promise.all(matchers.map((matcher) => matcher(snapshot)))).flat();
}

export function matchSemanticProjection(projection: SemanticProjection) {
  return (snapshot: TreeSnapshot): CheckpointDifference[] => {
    const differences: CheckpointDifference[] = [];
    for (const [index, assertion] of projection.entries()) {
      const nodes: SemanticNode[] = [];
      visit(snapshot.root, (node) => {
        if (matchesSelector(node, assertion.selector)) nodes.push(node);
      });
      const minimum = assertion.count?.min ?? 1;
      const maximum = assertion.count?.max ?? 1;
      if (nodes.length < minimum || nodes.length > maximum) {
        differences.push({ path: `assertions.${index}.count`, expected: { minimum, maximum }, actual: nodes.length, message: "Semantic node cardinality differs" });
        continue;
      }
      const node = nodes[0];
      if (!node) continue;
      compare(differences, `assertions.${index}.text`, assertion.properties?.text, node.text);
      compare(differences, `assertions.${index}.value`, assertion.properties?.value, node.value);
      compare(differences, `assertions.${index}.visible`, assertion.properties?.visible, node.states.visible);
      compare(differences, `assertions.${index}.enabled`, assertion.properties?.enabled, node.states.enabled);
    }
    return differences;
  };
}

export class CdpWebSocketClient implements CdpClient {
  private id = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message?: string } };
      if (response.id === undefined) return;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.error) pending.reject(new Error(response.error.message ?? "CDP request failed"));
      else pending.resolve(response.result);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("CDP connection closed"));
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<CdpWebSocketClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error(`Unable to connect to CDP at ${url}`)), { once: true });
    });
    return new CdpWebSocketClient(socket);
  }

  request<TResult>(method: string, params: Record<string, unknown> = {}): Promise<TResult> {
    const id = ++this.id;
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as TResult), reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.socket.addEventListener("close", () => resolve(), { once: true });
      this.socket.close();
    });
  }
}

export async function resolveCdpWebSocketUrl(
  endpoint: string | undefined,
  selector: CdpObserverOptions["target"] = {},
): Promise<string> {
  if (!endpoint) throw new Error("CDP observer requires endpoint or client");
  if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://")) return endpoint;
  const base = endpoint.replace(/\/$/, "");
  const response = await fetch(`${base}/json/list`);
  if (!response.ok) throw new Error(`CDP target discovery failed: HTTP ${response.status}`);
  const targets = await response.json() as Array<{ id?: string; title?: string; url?: string; type?: string; webSocketDebuggerUrl?: string }>;
  const targetType = selector.type ?? "page";
  const matches = targets.filter((target) =>
    target.type === targetType &&
    (!selector.id || target.id === selector.id) &&
    (!selector.title || target.title === selector.title) &&
    (!selector.url || target.url === selector.url));
  if (matches.length !== 1 || !matches[0]?.webSocketDebuggerUrl) {
    throw new Error(`CDP target selector resolved ${matches.length} targets; exactly one is required`);
  }
  return matches[0].webSocketDebuggerUrl;
}

function attributeMap(values: string[]): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    if (name) attributes[name] = values[index + 1] ?? "";
  }
  return attributes;
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function semanticRole(nodeName: string): string {
  if (nodeName === "#document") return "document";
  if (nodeName === "#text") return "#text";
  if (nodeName === "button") return "button";
  if (nodeName === "input") return "input";
  if (nodeName === "img") return "image";
  return nodeName;
}

function booleanAttribute(attributes: Record<string, string>, name: string): boolean | undefined {
  const value = attributes[name];
  return value === undefined ? undefined : value === "true";
}

function matchesSelector(node: SemanticNode, selector: SemanticSelector): boolean {
  return Object.entries(selector).every(([key, expected]) => expected === undefined || node[key as keyof SemanticSelector] === expected);
}

function visit(node: SemanticNode, callback: (node: SemanticNode) => void): void {
  callback(node);
  for (const child of node.children) visit(child, callback);
}

function compare(differences: CheckpointDifference[], path: string, expected: unknown, actual: unknown): void {
  if (expected !== undefined && expected !== actual) differences.push({ path, expected, actual, message: `${path} differs` });
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

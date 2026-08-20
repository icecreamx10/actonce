import { randomUUID } from "node:crypto";
import { canonicalTreeHash, ObservationCheckpointDriver, ReplayFlow, } from "@byted-lynx/actonce-replay";
export const CDP_TREE_SOURCE = {
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
export class CdpTreeObserver {
    source = CDP_TREE_SOURCE;
    async connect(context) {
        const client = context.options.client ?? await CdpWebSocketClient.connect(await resolveCdpWebSocketUrl(context.options.endpoint, context.options.target));
        await client.request("DOM.enable");
        return new CdpTreeSession(client, context.target.targetId);
    }
}
export class CdpTreeSession {
    client;
    targetId;
    source = CDP_TREE_SOURCE;
    sequence = 0;
    constructor(client, targetId) {
        this.client = client;
        this.targetId = targetId;
    }
    async capture() {
        const started = performance.now();
        const response = await this.client.request("DOM.getDocument", {
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
    async query(selector) {
        const snapshot = await this.capture();
        const matches = [];
        visit(snapshot.root, (node) => {
            if (matchesSelector(node, selector))
                matches.push(node);
        });
        return matches;
    }
    close() {
        return this.client.close();
    }
}
export function normalizeCdpNode(node) {
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
    });
}
function descendantText(children) {
    const parts = [];
    visitText(children, parts);
    return parts.join(" ") || undefined;
}
function visitText(nodes, parts) {
    for (const node of nodes) {
        if (node.text && node.role === "#text")
            parts.push(node.text);
        else
            visitText(node.children, parts);
    }
}
export function matchCanonicalTree(expectedHash) {
    return (snapshot) => snapshot.canonicalHash === expectedHash
        ? []
        : [{
                path: "tree.canonicalHash",
                expected: expectedHash,
                actual: snapshot.canonicalHash,
                message: "Canonical CDP tree differs",
            }];
}
export function createCdpReplayFlow(options) {
    return new ReplayFlow({
        checkpoints: new CdpCheckpointDriver(options),
        policy: options.policy,
        fallback: options.fallback,
        emit: options.emit,
        now: options.now,
        delay: options.delay,
    });
}
/** CDP lowering for the shared ActOnce observation checkpoint driver. */
export class CdpCheckpointDriver {
    driver;
    constructor(options) {
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
    verify(spec, context) {
        return this.driver.verify(spec, context);
    }
}
export function matchCdpCheckpoint(expected) {
    if (!expected.canonicalHash && !expected.projection) {
        throw new TypeError("CDP checkpoint requires canonicalHash or semantic projection");
    }
    const matchers = [];
    if (expected.canonicalHash)
        matchers.push(matchCanonicalTree(expected.canonicalHash));
    if (expected.projection)
        matchers.push(matchSemanticProjection(expected.projection));
    return async (snapshot) => (await Promise.all(matchers.map((matcher) => matcher(snapshot)))).flat();
}
export function matchSemanticProjection(projection) {
    return (snapshot) => {
        const differences = [];
        for (const [index, assertion] of projection.entries()) {
            const nodes = [];
            visit(snapshot.root, (node) => {
                if (matchesSelector(node, assertion.selector))
                    nodes.push(node);
            });
            const minimum = assertion.count?.min ?? 1;
            const maximum = assertion.count?.max ?? 1;
            if (nodes.length < minimum || nodes.length > maximum) {
                differences.push({ path: `assertions.${index}.count`, expected: { minimum, maximum }, actual: nodes.length, message: "Semantic node cardinality differs" });
                continue;
            }
            const node = nodes[0];
            if (!node)
                continue;
            compare(differences, `assertions.${index}.text`, assertion.properties?.text, node.text);
            compare(differences, `assertions.${index}.value`, assertion.properties?.value, node.value);
            compare(differences, `assertions.${index}.visible`, assertion.properties?.visible, node.states.visible);
            compare(differences, `assertions.${index}.enabled`, assertion.properties?.enabled, node.states.enabled);
        }
        return differences;
    };
}
export class CdpWebSocketClient {
    socket;
    id = 0;
    pending = new Map();
    constructor(socket) {
        this.socket = socket;
        socket.addEventListener("message", (event) => {
            const response = JSON.parse(String(event.data));
            if (response.id === undefined)
                return;
            const pending = this.pending.get(response.id);
            if (!pending)
                return;
            this.pending.delete(response.id);
            if (response.error)
                pending.reject(new Error(response.error.message ?? "CDP request failed"));
            else
                pending.resolve(response.result);
        });
        socket.addEventListener("close", () => {
            for (const pending of this.pending.values())
                pending.reject(new Error("CDP connection closed"));
            this.pending.clear();
        });
    }
    static async connect(url) {
        const socket = new WebSocket(url);
        await new Promise((resolve, reject) => {
            socket.addEventListener("open", () => resolve(), { once: true });
            socket.addEventListener("error", () => reject(new Error(`Unable to connect to CDP at ${url}`)), { once: true });
        });
        return new CdpWebSocketClient(socket);
    }
    request(method, params = {}) {
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve: (value) => resolve(value), reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }
    async close() {
        if (this.socket.readyState === WebSocket.CLOSED)
            return;
        await new Promise((resolve) => {
            this.socket.addEventListener("close", () => resolve(), { once: true });
            this.socket.close();
        });
    }
}
export async function resolveCdpWebSocketUrl(endpoint, selector = {}) {
    if (!endpoint)
        throw new Error("CDP observer requires endpoint or client");
    if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://"))
        return endpoint;
    const base = endpoint.replace(/\/$/, "");
    const response = await fetch(`${base}/json/list`);
    if (!response.ok)
        throw new Error(`CDP target discovery failed: HTTP ${response.status}`);
    const targets = await response.json();
    const targetType = selector.type ?? "page";
    const matches = targets.filter((target) => target.type === targetType &&
        (!selector.id || target.id === selector.id) &&
        (!selector.title || target.title === selector.title) &&
        (!selector.url || target.url === selector.url));
    if (matches.length !== 1 || !matches[0]?.webSocketDebuggerUrl) {
        throw new Error(`CDP target selector resolved ${matches.length} targets; exactly one is required`);
    }
    return matches[0].webSocketDebuggerUrl;
}
function attributeMap(values) {
    const attributes = {};
    for (let index = 0; index < values.length; index += 2) {
        const name = values[index];
        if (name)
            attributes[name] = values[index + 1] ?? "";
    }
    return attributes;
}
function normalizeText(value) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    return normalized || undefined;
}
function semanticRole(nodeName) {
    if (nodeName === "#document")
        return "document";
    if (nodeName === "#text")
        return "#text";
    if (nodeName === "button")
        return "button";
    if (nodeName === "input")
        return "input";
    if (nodeName === "img")
        return "image";
    return nodeName;
}
function booleanAttribute(attributes, name) {
    const value = attributes[name];
    return value === undefined ? undefined : value === "true";
}
function matchesSelector(node, selector) {
    return Object.entries(selector).every(([key, expected]) => expected === undefined || node[key] === expected);
}
function visit(node, callback) {
    callback(node);
    for (const child of node.children)
        visit(child, callback);
}
function compare(differences, path, expected, actual) {
    if (expected !== undefined && expected !== actual)
        differences.push({ path, expected, actual, message: `${path} differs` });
}
function compact(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
//# sourceMappingURL=index.js.map
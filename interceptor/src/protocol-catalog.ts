export type ProtocolCategory =
  | "session"
  | "configuration"
  | "observation"
  | "element-query"
  | "input"
  | "navigation"
  | "app-lifecycle"
  | "device-control"
  | "unknown";

export type StateEffect =
  | "none"
  | "session"
  | "ui"
  | "app"
  | "device"
  | "unknown";
export type ReplayRole = "candidate" | "context" | "exclude" | "unknown";
export type CheckpointRole =
  | "trigger"
  | "contributor"
  | "metadata"
  | "boundary"
  | "none";
export type CheckpointPhase =
  | "initial-state"
  | "after-settle"
  | "observation"
  | "final-state"
  | "on-error"
  | "none";
export type EvidenceKind =
  | "screenshot"
  | "native-ui"
  | "device-metadata"
  | "viewport"
  | "screen"
  | "element-query";

export type CheckpointPolicy = {
  role: CheckpointRole;
  phase: CheckpointPhase;
  provides: EvidenceKind[];
  requiredEvidence: EvidenceKind[];
};

export type ProtocolAnnotation = {
  ruleId: string;
  category: ProtocolCategory;
  operation: string;
  stateEffect: StateEffect;
  replayRole: ReplayRole;
  checkpoint: CheckpointPolicy;
  confidence: "exact" | "family" | "unknown";
};

type ProtocolRule = Omit<ProtocolAnnotation, "confidence"> & {
  method: string;
  target: RegExp;
  confidence?: "exact" | "family";
};

const completeStateEvidence: EvidenceKind[] = [
  "screenshot",
  "native-ui",
  "device-metadata",
];

const rules: ProtocolRule[] = [
  rule("session.status", "GET", /^\/status$/, "session", "status", "none", "exclude", checkpoint("none")),
  rule("session.create", "POST", /^\/session$/, "session", "create-session", "session", "exclude", checkpoint("boundary", "initial-state", [], completeStateEvidence)),
  rule("session.delete", "DELETE", /^\/session\/[^/]+$/, "session", "delete-session", "session", "exclude", checkpoint("boundary", "final-state", [], completeStateEvidence)),
  rule("session.settings", "POST", /^\/session\/[^/]+\/appium\/settings$/, "configuration", "configure-session", "session", "exclude", checkpoint("none")),
  rule("session.timeouts", "POST", /^\/session\/[^/]+\/timeouts$/, "configuration", "configure-timeouts", "session", "exclude", checkpoint("none")),

  rule("observation.screenshot", "GET", /^\/session\/[^/]+\/screenshot$/, "observation", "screenshot", "none", "context", checkpoint("trigger", "observation", ["screenshot"], completeStateEvidence)),
  rule("observation.source", "GET", /^\/session\/[^/]+\/source$/, "observation", "native-ui-source", "none", "context", checkpoint("trigger", "observation", ["native-ui"], completeStateEvidence)),
  rule("observation.window-rect", "GET", /^\/session\/[^/]+\/window\/rect$/, "observation", "window-rect", "none", "context", checkpoint("metadata", "none", ["viewport"])),
  rule("observation.screen", "GET", /^\/session\/[^/]+\/wda\/screen$/, "observation", "screen-info", "none", "context", checkpoint("metadata", "none", ["screen"])),

  rule("query.elements", "POST", /^\/session\/[^/]+\/elements?$/, "element-query", "find-element", "none", "context", checkpoint("contributor", "none", ["element-query"]), "family"),
  rule("query.element-state", "GET", /^\/session\/[^/]+\/element\/[^/]+\/(rect|text|displayed|enabled|selected|attribute\/[^/]+)$/, "element-query", "read-element", "none", "context", checkpoint("contributor", "none", ["element-query"]), "family"),

  rule("input.tap", "POST", /^\/session\/[^/]+\/wda\/tap$/, "input", "tap", "ui", "candidate", afterMutation()),
  rule("input.double-tap", "POST", /^\/session\/[^/]+\/wda\/doubleTap$/, "input", "double-tap", "ui", "candidate", afterMutation()),
  rule("input.long-press", "POST", /^\/session\/[^/]+\/wda\/touchAndHold$/, "input", "long-press", "ui", "candidate", afterMutation()),
  rule("input.gesture", "POST", /^\/session\/[^/]+\/wda\/(dragfromtoforduration|swipe)$/, "input", "gesture", "ui", "candidate", afterMutation(), "family"),
  rule("input.w3c-actions", "POST", /^\/session\/[^/]+\/actions$/, "input", "perform-actions", "ui", "candidate", afterMutation()),
  rule("input.release-actions", "DELETE", /^\/session\/[^/]+\/actions$/, "input", "release-actions", "ui", "candidate", afterMutation()),
  rule("input.keys", "POST", /^\/session\/[^/]+\/(wda\/keys|keys|element\/[^/]+\/value)$/, "input", "type-text", "ui", "candidate", afterMutation(), "family"),

  rule("app.launch", "POST", /^\/session\/[^/]+\/wda\/apps\/launch$/, "app-lifecycle", "launch-app", "app", "candidate", afterMutation()),
  rule("app.terminate", "POST", /^\/session\/[^/]+\/wda\/apps\/terminate$/, "app-lifecycle", "terminate-app", "app", "candidate", afterMutation()),
  rule("navigation.url", "POST", /^\/session\/[^/]+\/url$/, "navigation", "open-url", "app", "candidate", afterMutation()),
  rule("device.home", "POST", /^\/session\/[^/]+\/wda\/homescreen$/, "device-control", "home", "device", "candidate", afterMutation()),
  rule("device.button", "POST", /^\/session\/[^/]+\/wda\/pressButton$/, "device-control", "press-button", "device", "candidate", afterMutation()),
];

function checkpoint(
  role: CheckpointRole,
  phase: CheckpointPhase = "none",
  provides: EvidenceKind[] = [],
  requiredEvidence: EvidenceKind[] = [],
): CheckpointPolicy {
  return {
    role,
    phase,
    provides: [...provides],
    requiredEvidence: [...requiredEvidence],
  };
}

function afterMutation(): CheckpointPolicy {
  return checkpoint("trigger", "after-settle", [], completeStateEvidence);
}

function rule(
  ruleId: string,
  method: string,
  target: RegExp,
  category: ProtocolCategory,
  operation: string,
  stateEffect: StateEffect,
  replayRole: ReplayRole,
  checkpointPolicy: CheckpointPolicy,
  confidence: "exact" | "family" = "exact",
): ProtocolRule {
  return {
    ruleId,
    method,
    target,
    category,
    operation,
    stateEffect,
    replayRole,
    checkpoint: checkpointPolicy,
    confidence,
  };
}

export function annotateWdaRequest(
  method: string,
  target: string,
): ProtocolAnnotation {
  const normalizedMethod = method.toUpperCase();
  const pathname = new URL(target, "http://actonce.local").pathname;
  const match = rules.find(
    (candidate) =>
      candidate.method === normalizedMethod && candidate.target.test(pathname),
  );

  if (!match) {
    return {
      ruleId: "unknown",
      category: "unknown",
      operation: "unknown",
      stateEffect: "unknown",
      replayRole: "unknown",
      checkpoint: checkpoint(
        "trigger",
        "after-settle",
        [],
        completeStateEvidence,
      ),
      confidence: "unknown",
    };
  }

  return {
    ruleId: match.ruleId,
    category: match.category,
    operation: match.operation,
    stateEffect: match.stateEffect,
    replayRole: match.replayRole,
    checkpoint: match.checkpoint,
    confidence: match.confidence ?? "exact",
  };
}

export function normalizeWdaTarget(target: string): string {
  return new URL(target, "http://actonce.local").pathname
    .replace(/^\/session\/[^/]+/, "/session/:sessionId")
    .replace(/\/element\/[^/]+/g, "/element/:elementId");
}

export function protocolRuleCount(): number {
  return rules.length;
}

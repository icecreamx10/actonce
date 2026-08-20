export { MacSession } from "./session.js";
export { MacElement } from "./element.js";
export { locatorToWebdriver } from "./locator.js";
export { waitUntil } from "./wait.js";
export { doctor } from "./doctor.js";
export { captureMacRegionScreenshot } from "./screenshot.js";
export { MacCaptureClient } from "./capture-client.js";
export { MacCaptureService } from "./capture-service.js";
export { MacDeviceConnector } from "./device.js";
export { SwiftCaptureBackend, ensureCaptureHelper } from "./swift-capture-backend.js";
export type {
  CaptureBackendFrame,
  CaptureBackendTarget,
  CaptureServiceRequest,
  CaptureServiceResponse,
  MacCaptureBackend,
} from "./capture-protocol.js";
export type { MacDeviceConnectOptions } from "./device.js";
export type { MacRegionScreenshotOptions, MacScreenshotRegion } from "./screenshot.js";
export { runScripts, mergeConfigs } from "./runner.js";
export {
  centeredWindowFrame,
  isMacAccessibilityPermissionError,
  listMacDisplays,
  setupMacWindow,
  snapshotProcessIds,
} from "./window-setup.js";
export type {
  MacDisplayFrame,
  MacWindowFrame,
  MacWindowSetupOptions,
  MacWindowSetupResult,
} from "./window-setup.js";
export { compileMacPrimitives, compileMacPrimitivesFile } from "./primitive-compiler.js";
export type { CompileMacPrimitivesResult } from "./primitive-compiler.js";
export {
  compileMacObservationPlan,
  compileMacObservationPlanFile,
  validateMacObservationDecisions,
  validateMacObservationDecisionsFile,
} from "./observation-compiler.js";
export type {
  MacEvaluatorModality,
  MacObservationDecisionRecord,
  MacObservationMode,
  MacObservationPlan,
  MacObservationPlanItem,
} from "./observation-compiler.js";
export {
  replayMacPrimitive,
  SUPPORTED_MAC_PRIMITIVES,
  systemMacClipboard,
} from "./primitives.js";
export {
  MacCheckpointDriver,
  compareMacCheckpoint,
  createMacReplayFlow,
} from "./checkpoint.js";
export type {
  MacClipboard,
  MacPrimitiveOperation,
  MacPrimitiveSession,
  RecordedMacPrimitive,
  ReplayMacPrimitiveOptions,
} from "./primitives.js";
export type {
  MacLocator,
  MacReplayContext,
  MacReplayModule,
  MacReplayScript,
  MacSessionOptions,
  Point,
  Rect,
  WaitOptions,
} from "./types.js";
export type {
  MacCheckpointActual,
  MacCheckpointExpectation,
  MacElementExpectation,
  MacElementSnapshot,
  MacFallbackPlugin,
  MacFallbackPluginModule,
  MacReplayFlowOptions,
  MacTextExpectation,
  MacVisualComparison,
  MacVisualExpectation,
} from "./checkpoint.js";
export { compareVisualScreenshot } from "./checkpoint.js";

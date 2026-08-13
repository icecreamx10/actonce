/**
 * Midscene quarantine boundary.
 *
 * No other ActOnce workspace package may import or declare a dependency on
 * `@midscene/*`. Original AI execution and recording enter through this module;
 * deterministic replay runtimes use native platform backends instead.
 */
export * from "@midscene/android";
export * from "@midscene/computer";
export * from "@midscene/ios";
export declare function resolveMidsceneComputerAsset(relativePath: string): string;
//# sourceMappingURL=index.d.ts.map
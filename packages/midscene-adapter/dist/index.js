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
export function resolveMidsceneComputerAsset(relativePath) {
    const require = createRequire(import.meta.url);
    return join(dirname(require.resolve("@midscene/computer/package.json")), relativePath);
}
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
//# sourceMappingURL=index.js.map
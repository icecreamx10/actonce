/** Read-only shared-session smoke fragment. */
export default async function assertFinderWindow({ mac }) {
  const windows = await mac.findAll({ className: "XCUIElementTypeWindow" });
  if (windows.length === 0) {
    throw new Error("Finder did not expose a window in its AX tree");
  }
  const rect = await windows[0].rect();
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error(`Finder window has an invalid rectangle: ${JSON.stringify(rect)}`);
  }
}

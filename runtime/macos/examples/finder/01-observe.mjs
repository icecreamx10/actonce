export const config = {
  bundleId: "com.apple.finder",
  noReset: true,
};

/** Read-only shared-session smoke fragment. */
export default async function observeFinder({ mac }) {
  const source = await mac.source();
  if (!source.includes("XCUIElementTypeApplication")) {
    throw new Error("Finder AX source did not contain an application root");
  }
}

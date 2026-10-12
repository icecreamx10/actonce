/** Setup policy, separate from the declared app mapping supplied to the agent. */
export function initialTargetPolicy(task: string, apps: unknown) {
  const packages = [...new Set(Array.isArray(apps) ? apps.flatMap((app) =>
    app && typeof app.package === "string" && app.package ? [app.package as string] : []) : [])];
  // The pinned OpenAppTaskEval has no custom initializer: task.py resets to
  // home. Launching either the first candidate or params.app_name here changes
  // that official start state (and can satisfy the validator before timing).
  return { packages, initialPackage: task === "OpenAppTaskEval" ? undefined : packages[0] };
}

function component(line: string): string | undefined {
  return line.match(/\b([\w.]+\/[\w.$]+)(?=[\s}])/u)?.[1];
}

/** A system permission modal is ready only with exact foreground/requester evidence. */
export function isInitialTargetForeground(target: string, windows: string, activities: string): boolean {
  const focused = component(windows.split("\n").find((line) => line.includes("mCurrentFocus=")) ?? "");
  if (!focused) return false;
  if (focused.split("/")[0] === target) return true;
  const [controller, activity] = focused.split("/");
  if (!["com.google.android.permissioncontroller", "com.android.permissioncontroller"].includes(controller!)) return false;
  if (!["com.android.permissioncontroller.permission.ui.GrantPermissionsActivity", ".permission.ui.GrantPermissionsActivity"].includes(activity!)) return false;
  const top = activities.split("\n").find((line) => /(?:mResumedActivity|topResumedActivity)\s*[:=]/u.test(line));
  if (!top || component(top) !== focused) return false;
  const token = top.match(/ActivityRecord\{([^\s}]+)/u)?.[1];
  if (!token) return false;
  // Only inspect the detailed record for the exact resumed activity, not a
  // background permission request or an unrelated launchedFromPackage line.
  const lines = activities.split("\n");
  const index = lines.findIndex((line) => /^\s*\*?\s*Hist\s+#\d+:.*ActivityRecord\{/u.test(line) && line.includes(`ActivityRecord{${token} `));
  if (index < 0) return false;
  let end = index + 1;
  while (end < lines.length && !/^\s*\*?\s*(?:Hist\s+#\d+:|Task\{|RootTask\{)/u.test(lines[end]!)) end++;
  const record = lines.slice(index, end).join("\n");
  return component(lines[index]!) === focused && record.match(/\blaunchedFromPackage=([^\s]+)/u)?.[1] === target;
}

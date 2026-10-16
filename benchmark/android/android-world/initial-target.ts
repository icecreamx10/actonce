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
export function isInitialTargetForeground(target: string, windows: string, activities: string, requireLiveRequester = false): boolean {
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
  if (component(lines[index]!) !== focused || record.match(/\blaunchedFromPackage=([^\s]+)/u)?.[1] !== target) return false;
  // force-stop removes the requesting activity but can leave its system
  // permission window alive. launchedFromPackage survives that removal, so it
  // is attribution, not proof that dismissing the modal returns to the app.
  const lifecycle = permissionRequesterLifecycle(target, record, activities);
  return lifecycle === "live" || (lifecycle === "unknown" && !requireLiveRequester);
}

/** Missing vendor/dump fields are unknown, not proof that an activity died. */
export function permissionRequesterLifecycle(target: string, record: string, activities: string): "live" | "orphan" | "unknown" {
  const requester = record.match(/\bresultTo=ActivityRecord\{([^\s}]+)\s+u\d+\s+([^\s}]+)\}?\s+t(-?\d+)\b([^\n]*)/u);
  if (!requester) return "unknown";
  if (requester[3] === "-1" || /^\s+f\}/u.test(requester[4] ?? "")) return "orphan";
  const lines = activities.split("\n");
  const header = record.split("\n")[0]!;
  const task = header.match(/\bt(\d+)\b/u)?.[1];
  if (requester[2]?.split("/")[0] !== target || requester[3] !== task) return "unknown";
  const requesterIndex = lines.findIndex(line => /^\s*\*?\s*Hist\s+#\d+:.*ActivityRecord\{/u.test(line) && line.includes(`ActivityRecord{${requester[1]} `));
  if (requesterIndex < 0 || component(lines[requesterIndex]!) !== requester[2]) return "unknown";
  let requesterEnd = requesterIndex + 1;
  while (requesterEnd < lines.length && !/^\s*\*?\s*(?:Hist\s+#\d+:|Task\{|RootTask\{)/u.test(lines[requesterEnd]!)) requesterEnd++;
  const requesterRecord = lines.slice(requesterIndex, requesterEnd).join("\n");
  if (/\bfinishing=true\b/u.test(requesterRecord)) return "orphan";
  return lines[requesterIndex]!.match(/\bt(\d+)\b/u)?.[1] === task
    && /\bapp=ProcessRecord\{/u.test(requesterRecord)
    && /\bstate=(?:PAUSED|RESUMED|STARTED)\b/u.test(requesterRecord)
    && /\bfinishing=false\b/u.test(requesterRecord) ? "live" : "unknown";
}

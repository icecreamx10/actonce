import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Exercise the patched method from its hunk; no SDK/cache/bootstrap required.
const patchPath = resolve("benchmark/android/android-world/patches/0004-audio-recorder-exact-filename.patch");
const python = String.raw`
import ast, json, logging, sys, textwrap
from types import SimpleNamespace
lines = open(sys.argv[1]).read().splitlines()
start = next(i for i, line in enumerate(lines) if line.startswith("@@")) + 1
body = "\n".join(line[1:] for line in lines[start:] if line.startswith((" ", "+")))
source = ast.parse(textwrap.dedent(body) + "\n    return 0.0\n  return 1.0\n")
method = source.body[0]
class Base:
  def is_successful(self, env): return 1
target = sys.argv[3]
calls = []
def check(name, directory, controller):
  calls.append(name)
  return name == target
namespace = {"Base": Base, "interface": SimpleNamespace(AsyncEnv=object),
  "file_utils": SimpleNamespace(check_file_or_folder_exists=check), "logging": logging}
wrapper = ast.ClassDef(name="Patched", bases=[ast.Name(id="Base", ctx=ast.Load())], keywords=[], body=[method], decorator_list=[])
exec(compile(ast.fix_missing_locations(ast.Module(body=[wrapper], type_ignores=[])), "official-method", "exec"), namespace)
task = namespace["Patched"]()
task.params = {"file_name": sys.argv[2]}
task.create_file_task = SimpleNamespace(data_directory="/fixture/records")
print(json.dumps({"reward": task.is_successful(SimpleNamespace(controller=object())), "queried": calls}))
`;

describe("AndroidWorld named-audio evaluator", () => {
  it("keeps an applicable repository patch", () => {
    const patch = readFileSync(resolve("benchmark/android/android-world/patches/0004-audio-recorder-exact-filename.patch"), "utf8");
    expect(patch).toContain('target_name, self.create_file_task.data_directory');
  });
  it.each([
    ["discussion_JeH8.m4a", "discussion_JeH8.m4a", 1],
    ["discussion_JeH8.m4a", "discussion_JeH8.m4a.m4a", 0],
    ["discussion_JeH8.m4a", "unrelated.m4a", 0],
    ["memo", "memo.m4a", 1],
    ["Memo.M4A", "Memo.M4A", 1],
  ])("matches requested %s against %s => %s", (requested, existing, reward) => {
    const result = JSON.parse(execFileSync("python3", ["-c", python, patchPath, requested, existing], { encoding: "utf8" }));
    expect(result.reward).toBe(reward);
    expect(result.queried).toEqual([requested.toLowerCase().endsWith(".m4a") ? requested : `${requested}.m4a`]);
  });
});

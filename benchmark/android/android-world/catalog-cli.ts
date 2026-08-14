import {
  MIDSCENE_ANDROID_WORLD_REPORT,
  selectMidsceneAndroidWorldCases,
  type MidscenePassSelection,
} from "./catalog.js";

const args = parseArgs(process.argv.slice(2));
const cases = selectMidsceneAndroidWorldCases(args.selection);

if (args.format === "lines") {
  for (const entry of cases) console.log(entry.task);
} else {
  console.log(JSON.stringify({
    schemaVersion: 1,
    selection: args.selection,
    source: MIDSCENE_ANDROID_WORLD_REPORT,
    count: cases.length,
    cases,
  }, null, 2));
}

function parseArgs(values: string[]): { selection: MidscenePassSelection; format: "json" | "lines" } {
  let selection: MidscenePassSelection = "pass@3";
  let format: "json" | "lines" = "json";
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--selection") selection = values[++index] as MidscenePassSelection;
    else if (values[index] === "--format") format = values[++index] as "json" | "lines";
    else throw new Error(`Unknown argument: ${values[index]}`);
  }
  if (selection !== "pass@1" && selection !== "pass@3") throw new Error(`Unknown selection: ${selection}`);
  if (format !== "json" && format !== "lines") throw new Error(`Unknown format: ${format}`);
  return { selection, format };
}

import { chmod, mkdir, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(
  process.argv[2] ?? resolve(packageRoot, "artifacts/actonce-checkpoint.mjs"),
);
const temporary = `${output}.tmp`;

await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: [resolve(packageRoot, "src/cli.ts")],
  outfile: temporary,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  sourcemap: false,
});
await chmod(temporary, 0o755);
await rename(temporary, output);
console.log(output);

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';

// Explicit publication allowlist, not a recording compiler or general log copier.
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/export-camera-video-evidence.mjs <sample> <new-output>');
const source = resolve(input), destination = resolve(output);
if (destination === source || destination.startsWith(source + sep)) throw new Error('Output must be separate from source');
await mkdir(destination, { recursive: false }); // Never overwrite existing evidence.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identities = [];
const read = async name => readFile(resolve(source, name));
const json = async name => JSON.parse(await read(name));
const suspicious = /(?:\bBearer\s+[A-Za-z0-9._-]{16,}|\bark-[a-f0-9-]{25,}|\bsk-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;
async function put(name, bytes) {
  if (suspicious.test(bytes.toString('utf8'))) throw new Error(`Potential credential in ${name}; export stopped`);
  const path = resolve(destination, name);
  if (!path.startsWith(destination + sep)) throw new Error('Unsafe output path');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
async function preserve(name, target = name) {
  const bytes = await read(name);
  await put(target, bytes);
  identities.push({ source: name, published: target, sha256: sha(bytes), byteIdentical: true });
}
const originalManifest = await json('original/manifest.json');
const all = (await read('original/events.ndjson')).toString('utf8').trim().split('\n').map(JSON.parse);
if (originalManifest.status !== 'complete' || all.length !== originalManifest.eventCount) throw new Error('Incomplete original');
const allowedKinds = new Set(['checkpoint.captured', 'logical.action.started', 'logical.action.completed']);
const events = all.flatMap(e => {
  if (allowedKinds.has(e.kind)) return [e];
  if (e.kind === 'midscene.progress' && e.progress?.scope === 'aiAct' && ['start', 'complete'].includes(e.progress.phase)) {
    const { data, ...boundary } = e.progress;
    return [{ ...e, progress: boundary }]; // Keep attempt boundaries, never model thought/output.
  }
  return [];
});
if (events.filter(e => e.kind === 'logical.action.completed').length !== 9) throw new Error('Unexpected action count');
const artifacts = new Map();
function references(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.path === 'string' && value.path.startsWith('artifacts/')) {
    if (!/^artifacts\/[a-f0-9]{2}\/[a-f0-9]{64}$/.test(value.path)) throw new Error('Unexpected artifact path');
    artifacts.set(value.path, value);
  }
  for (const child of Object.values(value)) references(child);
}
for (const event of events) references(event);
for (const [path, ref] of artifacts) {
  const bytes = await read('original/' + path);
  if (sha(bytes) !== ref.sha256 || bytes.length !== ref.size) throw new Error(`Artifact integrity failed: ${path}`);
  if (!['image/png', 'application/json'].includes(ref.mediaType)) throw new Error('Unexpected evidence type');
  await preserve('original/' + path);
}
await preserve('original/manifest.json', 'original/source-manifest.json');
await put('original/events.ndjson', Buffer.from(events.map(e => JSON.stringify(e)).join('\n') + '\n'));
await put('original/manifest.json', Buffer.from(JSON.stringify({ ...originalManifest,
  eventCount: events.length,
  sources: originalManifest.sources.map(s => ({ ...s, eventCount: events.filter(e => e.source?.type === s.type).length })),
  metadata: { ...originalManifest.metadata, publication: { kind: 'action-and-checkpoint-projection',
    sourceEventCount: all.length, sourceEventsSha256: sha(await read('original/events.ndjson')),
    omittedEventKinds: ['midscene.progress (except data-free attempt boundaries)', 'midscene.execution-dump.updated'],
    originalStatus: originalManifest.status, excludesModelRequestsAndReasoning: true } }
}, null, 2) + '\n'));
for (const name of ['original/result.json', 'formal-provenance.json', 'formal-summary.json',
  'task-state/task.json', 'task-state/runtime-permissions.json', 'task-state/start-environment.json',
  'synthesized-v1/replay-module.ts', 'synthesized-v1/replay-plan.json', 'synthesized-v1/synthesis-ledger.json',
  'synthesized-v1/replay-oracle.json', 'synthesized-v1/assertion-decision.json', 'synthesized-v1/qualification.json',
  'synthesized-v1/evidence-calibration.json', 'synthesized-v1/pre-lowering-gate.json', 'synthesized-v1/plan-gate.json',
  'formal-replay/evaluation.json', 'formal-replay/formal-provenance.json', 'formal-replay/formal-summary.json',
  'formal-replay/replay/result.json', 'formal-replay/replay/benchmark-result.json',
  'formal-replay/replay/events.json', 'formal-replay/replay/final-source.json', 'formal-replay/replay/final.png']) await preserve(name);
await put('publication.json', Buffer.from(JSON.stringify({ schemaVersion: 1, task: 'CameraTakeVideo',
  sourceManifestSha256: sha(await read('original/manifest.json')), sourceEventsSha256: sha(await read('original/events.ndjson')),
  sourceEventCount: all.length, exportedEventCount: events.length, checkpointCount: 27, logicalActionCount: 9,
  referencedArtifactCount: artifacts.size, byteIdenticalFiles: identities,
  exclusions: ['Midscene progress/execution dumps, model requests, reasoning, HTML reports, command logs',
    'Opaque pickle/app snapshots, full development failure folders; qualification retains failure history'],
  timingAndMeasurementUnchanged: true, portableEntryIsNotMeasuredModule: true }, null, 2) + '\n'));
async function hashes(dir) {
  const lines = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) lines.push(...await hashes(path));
    else if (entry.isFile()) lines.push(`${sha(await readFile(path))}  ${relative(destination, path).split(sep).join('/')}`);
    else throw new Error('Symlinks are not published');
  }
  return lines;
}
await put('SHA256SUMS', Buffer.from((await hashes(destination)).sort().join('\n') + '\n'));
console.log(JSON.stringify({ output, events: events.length, artifacts: artifacts.size, files: identities.length }));

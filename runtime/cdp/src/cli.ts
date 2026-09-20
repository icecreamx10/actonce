#!/usr/bin/env node
import { serveExternalCdpCheckpoints } from "./external-checkpoint-service.js";

const [command] = process.argv.slice(2);
if (command === "serve-stdio") {
  await serveExternalCdpCheckpoints(process.stdin, process.stdout);
} else {
  console.log(`ActOnce CDP checkpoint service

Usage:
  actonce-checkpoint serve-stdio`);
  if (command && command !== "help" && command !== "--help") process.exitCode = 2;
}

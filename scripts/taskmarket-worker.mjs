#!/usr/bin/env node

// Runs one TaskMarket command with the isolated worker keystore, then restores
// the requester's global keystore even when the child command fails.

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workspace = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const stateDir = path.join(workspace, "live", ".state");
const workerStore = path.join(stateDir, "taskmarket-worker-keystore.json");
const canonical = path.join(os.homedir(), ".taskmarket", "keystore.json");
const backup = path.join(os.homedir(), ".taskmarket", `keystore.requester-backup.${process.pid}.json`);
const cli = path.join(workspace, "node_modules", ".bin", "taskmarket");

if (!existsSync(workerStore)) throw new Error("Worker profile missing. Run: node scripts/import-taskmarket-worker.mjs");
if (!existsSync(canonical)) throw new Error(`Requester keystore not found at ${canonical}.`);
if (existsSync(backup)) throw new Error(`Refusing to overwrite recovery file ${backup}.`);

const requester = JSON.parse(readFileSync(canonical, "utf8")).walletAddress;
const worker = JSON.parse(readFileSync(workerStore, "utf8")).walletAddress;
if (requester.toLowerCase() === worker.toLowerCase()) {
  throw new Error("Requester and worker profiles resolve to the same wallet.");
}

mkdirSync(stateDir, { recursive: true });
renameSync(canonical, backup);
copyFileSync(workerStore, canonical);
chmodSync(canonical, 0o600);

let status = 1;
try {
  const result = spawnSync(cli, process.argv.slice(2), { cwd: workspace, stdio: "inherit" });
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally {
  if (existsSync(canonical)) {
    copyFileSync(canonical, workerStore);
    chmodSync(workerStore, 0o600);
  }
  if (existsSync(backup)) renameSync(backup, canonical);
}

process.exit(status);

#!/usr/bin/env node

// Imports WORKER_EVM_PRIVATE_KEY through TaskMarket's hidden stdin prompt while
// preserving the requester's global keystore. The raw key is never printed,
// passed as an argument, or placed in the child process environment.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";

const workspace = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envFile = path.join(workspace, "live", ".env.local");
const stateDir = path.join(workspace, "live", ".state");
const workerStore = path.join(stateDir, "taskmarket-worker-keystore.json");
const canonical = path.join(os.homedir(), ".taskmarket", "keystore.json");
const backup = path.join(os.homedir(), ".taskmarket", `keystore.requester-backup.${process.pid}.json`);
const cli = path.join(workspace, "node_modules", ".bin", "taskmarket");

function publicKeystoreAddress(file) {
  return JSON.parse(readFileSync(file, "utf8")).walletAddress;
}

const env = readFileSync(envFile, "utf8");
const match = /^WORKER_EVM_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m.exec(env);
if (!match) throw new Error("WORKER_EVM_PRIVATE_KEY is missing or invalid. Run: npm run new-worker-key");
const workerKey = match[1];
const workerAddress = privateKeyToAccount(workerKey).address;

mkdirSync(stateDir, { recursive: true });
if (existsSync(workerStore)) {
  if (publicKeystoreAddress(workerStore).toLowerCase() !== workerAddress.toLowerCase()) {
    throw new Error("Stored TaskMarket worker keystore does not match WORKER_EVM_PRIVATE_KEY.");
  }
  console.log(JSON.stringify({ ok: true, data: { address: workerAddress, existing: true } }));
  process.exit(0);
}
if (!existsSync(canonical)) throw new Error(`Requester keystore not found at ${canonical}.`);
if (existsSync(backup)) throw new Error(`Refusing to overwrite recovery file ${backup}.`);

renameSync(canonical, backup);
let imported = false;
try {
  const result = spawnSync(cli, ["wallet", "import"], {
    cwd: workspace,
    input: `${workerKey}\n`,
    stdio: ["pipe", "inherit", "inherit"],
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (!existsSync(canonical)) throw new Error("TaskMarket did not create the worker keystore.");
  if (publicKeystoreAddress(canonical).toLowerCase() !== workerAddress.toLowerCase()) {
    throw new Error("Imported TaskMarket keystore does not match the generated worker.");
  }
  renameSync(canonical, workerStore);
  chmodSync(workerStore, 0o600);
  imported = true;
  if (result.status !== 0) throw new Error(`TaskMarket import exited with status ${result.status}.`);
} finally {
  if (existsSync(backup)) renameSync(backup, canonical);
}

if (!imported) process.exit(1);
console.log(JSON.stringify({ ok: true, data: { address: workerAddress, existing: false } }));

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { TaskMarketState } from "./web/steps";

const execFileAsync = promisify(execFile);
const TASK_ID = /^0x[0-9a-fA-F]{64}$/;
const BASE_CHAIN_ID = 8453;
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveAmount(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const amount = BigInt(value);
  return amount > 0n ? amount : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function validateTaskId(taskId: string): string {
  if (!TASK_ID.test(taskId)) throw new Error("Task ID must be a 0x-prefixed 32-byte hex value.");
  return taskId.toLowerCase();
}

// Use completed, event-backed awards rather than reward/netReward estimates.
// A task can have multiple winners, so only the agent's own award is eligible.
export function parseEarnedTask(payload: unknown, taskId: string, agentAddress: string): TaskMarketState {
  validateTaskId(taskId);
  const envelope = record(payload);
  if (!envelope || envelope.ok !== true) throw new Error("Taskmarket did not return a successful task read.");
  const data = record(envelope.data);
  const task = record(data?.task) ?? data;
  if (!task || text(task.id)?.toLowerCase() !== taskId.toLowerCase()) {
    throw new Error("Taskmarket returned a different task.");
  }
  if (Number(task.chainId) !== BASE_CHAIN_ID) {
    throw new Error("This agent only shields Taskmarket payouts on Base mainnet.");
  }
  if (task.status !== "completed") {
    throw new Error("Taskmarket has not indexed a completed payout for this task.");
  }
  if (!Array.isArray(task.awards)) {
    throw new Error("Taskmarket did not return event-backed settlement awards.");
  }
  const ownAwards = task.awards
    .map(record)
    .filter((award): award is Record<string, unknown> => Boolean(award))
    .filter((award) => text(award.workerAddress)?.toLowerCase() === agentAddress.toLowerCase());
  if (!ownAwards.length) {
    throw new Error("The configured agent wallet did not receive an award on this task.");
  }
  let workerPayment = 0n;
  for (const award of ownAwards) {
    const amount = positiveAmount(award.workerPayment);
    if (amount === null) throw new Error("Taskmarket returned an invalid worker payment.");
    workerPayment += amount;
  }

  return {
    id: taskId,
    requester: text(task.requester),
    worker: agentAddress,
    reward: positiveAmount(task.reward),
    workerPayment,
    status: "completed",
    description: text(task.description),
    submitted: true,
    settled: true,
    escrowTxHash: text(task.escrowTxHash),
    source: "external",
  };
}

export async function readEarnedTask(taskId: string, agentAddress: string): Promise<TaskMarketState> {
  taskId = validateTaskId(taskId);
  const cli = resolve(workspace, "node_modules/.bin/taskmarket");
  const env: NodeJS.ProcessEnv = { ...process.env, TASKMARKET_NETWORK: "base" };
  // The CLI needs no bridge secrets for a task read. Keep them out of its child
  // environment, and do not echo stderr if the read fails.
  for (const key of Object.keys(env)) {
    if (/^(?:AGENT_|WORKER_|AVNU_|PROVER_URL$|INDEXER_URL$|STARKNET_RPC_URL$|BASE_RPC_URL$)/.test(key)) {
      delete env[key];
    }
  }
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(cli, ["task", "get", taskId], {
      cwd: workspace,
      env,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    }));
  } catch {
    throw new Error("Taskmarket task read failed. Check the CLI, Base network, and task ID.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(stdout.trim());
  } catch {
    throw new Error("Taskmarket returned invalid JSON for the task read.");
  }
  return parseEarnedTask(payload, taskId, agentAddress);
}

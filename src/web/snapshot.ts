import { existsSync, readFileSync } from "node:fs";
import type {
  DepositReceipt,
  Snapshot,
  TaskMarketState,
  WithdrawalReceipt,
} from "./steps";

export interface SnapshotResult {
  snapshot: Snapshot;
  warnings: string[];
}

// Every read is independently tolerant: one unreachable service must degrade a
// single row to "unread" rather than blanking the whole board.
export async function gather(readers: {
  task: () => TaskMarketState;
  baseUsdc: () => Promise<bigint>;
  payoutUsdc: () => Promise<bigint>;
  privateUsdc: () => Promise<bigint>;
  transfer: () => Promise<Snapshot["transfer"]>;
  deposit: () => DepositReceipt | null;
  withdrawal: () => WithdrawalReceipt | null;
}): Promise<SnapshotResult> {
  const warnings: string[] = [];

  async function tryRead<T>(label: string, read: () => Promise<T> | T, fallback: T): Promise<T> {
    try {
      return await read();
    } catch (error) {
      warnings.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      return fallback;
    }
  }

  const emptyTask: TaskMarketState = {
    id: null,
    requester: null,
    worker: null,
    reward: null,
    status: null,
    description: null,
    submitted: false,
    settled: false,
    escrowTxHash: null,
  };

  return {
    snapshot: {
      task: await tryRead("task", readers.task, emptyTask),
      baseUsdc: await tryRead("worker balance", readers.baseUsdc, null as bigint | null),
      payoutUsdc: await tryRead("payout balance", readers.payoutUsdc, null as bigint | null),
      privateUsdc: await tryRead("private balance", readers.privateUsdc, null as bigint | null),
      transfer: await tryRead("transfer status", readers.transfer, null),
      deposit: await tryRead("deposit receipt", readers.deposit, null),
      withdrawal: await tryRead("withdrawal receipt", readers.withdrawal, null),
    },
    warnings,
  };
}

const TASK_FILES = ["create.json", "before-submit.json", "submit.json", "before-accept.json", "accept.json", "completed.json"];

function objectData(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const top = raw as Record<string, unknown>;
  const data = top.data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : top;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function bigintField(value: unknown): bigint | null {
  try {
    return typeof value === "string" || typeof value === "number" ? BigInt(value) : null;
  } catch {
    return null;
  }
}

// Read only the runner's public response files. The same directory may contain
// an encrypted TaskMarket keystore, which is deliberately outside this allowlist.
export function readTaskMarketState(dir: string): TaskMarketState {
  const records = TASK_FILES.map((name) => {
    try {
      return objectData(`${dir}/${name}`);
    } catch {
      return null;
    }
  }).filter((record): record is Record<string, unknown> => record !== null);

  let id: string | null = null;
  let requester: string | null = null;
  let reward: bigint | null = null;
  let status: string | null = null;
  let description: string | null = null;
  let escrowTxHash: string | null = null;
  let submissionCount = 0;

  for (const record of records) {
    id = stringField(record.id) ?? stringField(record.taskId) ?? id;
    requester = stringField(record.requester) ?? requester;
    reward = bigintField(record.reward) ?? reward;
    status = stringField(record.status)?.toLowerCase() ?? status;
    description = stringField(record.description) ?? description;
    escrowTxHash = stringField(record.escrowTxHash) ?? escrowTxHash;
    const count = Number(record.submissionCount ?? 0);
    if (Number.isFinite(count)) submissionCount = Math.max(submissionCount, count);
  }

  let worker: string | null = null;
  try {
    worker = stringField(readFileSync(`${dir}/worker-address.txt`, "utf8").trim());
  } catch {
    // Submission has not completed through the guarded runner yet.
  }

  const submitted = Boolean(worker) || submissionCount > 0 || existsSync(`${dir}/submit.json`);
  const settled =
    existsSync(`${dir}/accept.json`) ||
    status === "accepted" ||
    status === "completed" ||
    status === "paid";

  return { id, requester, worker, reward, status, description, submitted, settled, escrowTxHash };
}

export function readDepositReceipt(dir: string): DepositReceipt | null {
  const record = objectData(`${dir}/deposit-receipt.json`);
  if (!record) return null;
  const amountNet = bigintField(record.amountNet);
  if (amountNet === null) return null;
  return {
    burnTxHash: stringField(record.burnTxHash),
    poolTxHash: stringField(record.poolTxHash),
    amountNet,
    completedAt: stringField(record.completedAt),
  };
}

export function readWithdrawalReceipt(dir: string): WithdrawalReceipt | null {
  const record = objectData(`${dir}/withdrawal-receipt.json`);
  if (!record) return null;
  const burnTxHash = stringField(record.burnTxHash);
  const destination = stringField(record.destination);
  const amountNet = bigintField(record.amountNet);
  if (!burnTxHash || !destination || amountNet === null) return null;
  return {
    burnTxHash,
    forwardTxHash: stringField(record.forwardTxHash),
    destination,
    amountNet,
  };
}

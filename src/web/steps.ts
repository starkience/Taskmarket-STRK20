// The live demo, end to end. A checkpoint is marked complete only from state we
// can observe locally or on-chain; unread state never becomes a green tick.

export type StepState = "done" | "active" | "pending" | "unknown";
export type StepNetwork = "TaskMarket" | "Base" | "Starknet" | "STRK20";

export interface Step {
  readonly n: number;
  readonly title: string;
  readonly network: StepNetwork;
  readonly state: StepState;
  readonly detail: string;
  readonly content?: string;
  readonly txHash?: string;
  readonly explorer?: "base" | "starknet";
}

export interface TaskMarketState {
  readonly id: string | null;
  readonly requester: string | null;
  readonly worker: string | null;
  readonly reward: bigint | null;
  readonly status: string | null;
  readonly description: string | null;
  readonly submitted: boolean;
  readonly settled: boolean;
  readonly escrowTxHash: string | null;
}

export interface DepositReceipt {
  readonly burnTxHash: string | null;
  readonly poolTxHash: string | null;
  readonly amountNet: bigint;
  readonly completedAt: string | null;
}

export interface WithdrawalReceipt {
  readonly burnTxHash: string;
  readonly forwardTxHash: string | null;
  readonly destination: string;
  readonly amountNet: bigint;
}

export interface Snapshot {
  readonly task: TaskMarketState;
  /** Public USDC on the worker's Base EOA, base units. */
  readonly baseUsdc: bigint | null;
  /** Public USDC on the fresh payout EOA, base units. */
  readonly payoutUsdc: bigint | null;
  /** bridge-core's in-flight transfer, if any. */
  readonly transfer: {
    readonly direction: "into-pool" | "from-pool";
    readonly phase: string;
    readonly amountWei: bigint;
  } | null;
  /** Private USDC held in the pool, base units. */
  readonly privateUsdc: bigint | null;
  readonly deposit: DepositReceipt | null;
  readonly withdrawal: WithdrawalReceipt | null;
}

const USDC = 6;

export function formatUsdc(value: bigint | null): string {
  if (value === null) return "—";
  const whole = value / 10n ** BigInt(USDC);
  const frac = (value % 10n ** BigInt(USDC)).toString().padStart(USDC, "0").slice(0, 2);
  return `${whole}.${frac} USDC`;
}

function shorten(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function deriveSteps(s: Snapshot): Step[] {
  const movingIn = s.transfer?.direction === "into-pool";
  const movingOut = s.transfer?.direction === "from-pool";
  const inPool = s.privateUsdc !== null && s.privateUsdc > 0n;
  const depositDone = Boolean(s.deposit) || inPool || movingOut || Boolean(s.withdrawal);
  const withdrawalDone = Boolean(s.withdrawal);

  const burnInDone = depositDone || movingIn;
  const mintInDone = depositDone || (movingIn && s.transfer?.phase === "pool-deposit");

  return [
    {
      n: 1,
      title: "Bounty escrowed",
      network: "TaskMarket",
      state: s.task.id ? "done" : "pending",
      detail: s.task.reward === null ? "waiting for bounty" : `${formatUsdc(s.task.reward)} locked`,
      ...(s.task.description ? { content: s.task.description } : {}),
      ...(s.task.escrowTxHash
        ? { txHash: s.task.escrowTxHash, explorer: "base" as const }
        : {}),
    },
    {
      n: 2,
      title: "Work submitted",
      network: "TaskMarket",
      state: s.task.submitted ? "done" : s.task.id ? "active" : "pending",
      detail: s.task.worker ? shorten(s.task.worker) : "worker ready",
    },
    {
      n: 3,
      title: "Worker paid",
      network: "Base",
      state: s.task.settled ? "done" : s.task.submitted ? "active" : "pending",
      detail: s.baseUsdc === null ? "balance unread" : formatUsdc(s.baseUsdc),
    },
    {
      n: 4,
      title: "USDC burned",
      network: "Base",
      state: burnInDone ? "done" : s.task.settled ? "active" : "pending",
      detail: burnInDone ? "CCTP Base → Starknet" : "awaiting deposit",
      ...(s.deposit?.burnTxHash
        ? { txHash: s.deposit.burnTxHash, explorer: "base" as const }
        : {}),
    },
    {
      n: 5,
      title: "USDC minted",
      network: "Starknet",
      state: mintInDone ? "done" : movingIn ? "active" : "pending",
      detail: movingIn && s.transfer?.phase === "cctp-mint-in" ? "Circle attestation" : "CCTP arrival",
    },
    {
      n: 6,
      title: "Pool deposit",
      network: "STRK20",
      state: depositDone ? "done" : movingIn && s.transfer?.phase === "pool-deposit" ? "active" : "pending",
      detail: s.privateUsdc === null ? "private balance unread" : formatUsdc(s.privateUsdc),
      ...(s.deposit?.poolTxHash
        ? { txHash: s.deposit.poolTxHash, explorer: "starknet" as const }
        : {}),
    },
    {
      n: 7,
      title: "Privacy set",
      network: "STRK20",
      state: movingOut || withdrawalDone ? "done" : depositDone ? "active" : "pending",
      detail: depositDone ? "deposit ↛ withdrawal" : "funds must rest in pool",
    },
    {
      n: 8,
      title: "Pool withdrawal",
      network: "STRK20",
      state: movingOut || withdrawalDone ? "done" : "pending",
      detail: withdrawalDone ? formatUsdc(s.withdrawal?.amountNet ?? null) : "separate later action",
      ...(s.withdrawal?.burnTxHash
        ? { txHash: s.withdrawal.burnTxHash, explorer: "starknet" as const }
        : {}),
    },
    {
      n: 9,
      title: "USDC burned",
      network: "Starknet",
      state: movingOut || withdrawalDone ? "done" : "pending",
      detail: movingOut || withdrawalDone ? "CCTP Starknet → Base" : "—",
      ...(s.withdrawal?.burnTxHash
        ? { txHash: s.withdrawal.burnTxHash, explorer: "starknet" as const }
        : {}),
    },
    {
      n: 10,
      title: "Fresh wallet funded",
      network: "Base",
      state: withdrawalDone ? "done" : movingOut ? "active" : "pending",
      detail: withdrawalDone
        ? `${formatUsdc(s.payoutUsdc)} · ${shorten(s.withdrawal?.destination ?? "")}`
        : "no direct worker edge",
      ...(s.withdrawal?.forwardTxHash
        ? { txHash: s.withdrawal.forwardTxHash, explorer: "base" as const }
        : {}),
    },
  ];
}

export function overallProgress(steps: readonly Step[]): number {
  return steps.filter((s) => s.state === "done").length;
}

import { formatUnits } from "../lib/amounts";
import type { Snapshot } from "./steps";

export type DashboardActionId =
  | "submit"
  | "accept"
  | "deposit"
  | "resume-deposit"
  | "withdraw"
  | "resume-withdraw";

export interface DashboardAction {
  readonly id: DashboardActionId;
  readonly step: number;
  readonly label: string;
  readonly detail: string;
  readonly confirmation: string;
  /** Decimal command amount for bridge actions; never key material. */
  readonly amount?: string;
  readonly taskId?: string;
}

const DEPOSIT_AMOUNT = 5_000_000n;
const WITHDRAW_RESERVE = 250_000n;
const WITHDRAW_QUANTUM = 500_000n;
const EARNINGS_RESERVE = 100_000n;

function usdcCommandAmount(amount: bigint): string {
  return formatUnits(amount, 6);
}

function bridgeConfirmation(action: "deposit" | "withdraw", amount: bigint): string {
  return `${action} ${usdcCommandAmount(amount)} USDC`;
}

function roundWithdrawal(privateUsdc: bigint): bigint {
  if (privateUsdc <= WITHDRAW_RESERVE) return 0n;
  return ((privateUsdc - WITHDRAW_RESERVE) / WITHDRAW_QUANTUM) * WITHDRAW_QUANTUM;
}

// At most one action is exposed. Availability is derived from a fresh snapshot
// again on POST, so a stale button cannot start a second burn.
export function deriveDashboardActions(
  snapshot: Snapshot,
  dashboardStartedAt: number,
): DashboardAction[] {
  const { task, transfer } = snapshot;

  if (task.source !== "external" && task.id && !task.submitted) {
    return [
      {
        id: "submit",
        step: 2,
        label: "Submit work",
        detail: "Signs the prepared Markdown artifact with the isolated worker.",
        confirmation: `SUBMIT ${task.id}`,
      },
    ];
  }

  if (task.source !== "external" && task.id && task.submitted && !task.settled && task.worker) {
    return [
      {
        id: "accept",
        step: 3,
        label: "Accept & pay",
        detail: "Costs 0.001 USDC and releases the escrow to this worker.",
        confirmation: `ACCEPT ${task.id} FOR ${task.worker}`,
      },
    ];
  }

  if (transfer?.direction === "into-pool") {
    if (task.source === "external" && (
      snapshot.earningIntent?.taskId !== task.id ||
      snapshot.earningIntent.amountWei !== transfer.amountWei
    )) return [];
    const amount = usdcCommandAmount(transfer.amountWei);
    return [
      {
        id: "resume-deposit",
        step: transfer.phase === "pool-deposit" ? 6 : 5,
        label: "Resume deposit",
        detail: "Resumes the recorded transfer; it does not issue another Base burn.",
        confirmation: bridgeConfirmation("deposit", transfer.amountWei),
        amount,
        ...(task.source === "external" && task.id ? { taskId: task.id } : {}),
      },
    ];
  }

  if (transfer?.direction === "from-pool") {
    const amount = usdcCommandAmount(transfer.amountWei);
    return [
      {
        id: "resume-withdraw",
        step: 10,
        label: "Resume withdrawal",
        detail: "Resumes from the recorded Starknet burn toward the same payout wallet.",
        confirmation: bridgeConfirmation("withdraw", transfer.amountWei),
        amount,
      },
    ];
  }

  const depositDone = task.source === "external"
    ? snapshot.deposit?.taskId === task.id
    : Boolean(snapshot.deposit) || (snapshot.privateUsdc ?? 0n) > 0n;
  const earnedCap = task.source === "external"
    ? (snapshot.baseUsdc ?? 0n) < (task.workerPayment ?? 0n)
      ? snapshot.baseUsdc ?? 0n
      : task.workerPayment ?? 0n
    : DEPOSIT_AMOUNT;
  const depositAmount = task.source === "external"
    ? earnedCap > EARNINGS_RESERVE
      ? ((earnedCap - EARNINGS_RESERVE) / WITHDRAW_QUANTUM) * WITHDRAW_QUANTUM
      : 0n
    : DEPOSIT_AMOUNT;
  if (task.settled && !depositDone && depositAmount > 0n && (snapshot.baseUsdc ?? 0n) >= depositAmount) {
    return [
      {
        id: "deposit",
        step: 4,
        label: `Deposit ${usdcCommandAmount(depositAmount)} USDC`,
        detail: "Requires Base ETH. Runs status first, then Base → Starknet → STRK20.",
        confirmation: bridgeConfirmation("deposit", depositAmount),
        amount: usdcCommandAmount(depositAmount),
        ...(task.source === "external" && task.id ? { taskId: task.id } : {}),
      },
    ];
  }

  const completedAt = Date.parse(snapshot.deposit?.completedAt ?? "");
  const isLaterDashboardSession = Number.isFinite(completedAt) && dashboardStartedAt > completedAt;
  const privateUsdc = snapshot.privateUsdc ?? 0n;
  const withdrawalAmount = roundWithdrawal(privateUsdc);
  if (depositDone && isLaterDashboardSession && !snapshot.withdrawal && withdrawalAmount > 0n) {
    return [
      {
        id: "withdraw",
        step: 7,
        label: `Withdraw ${usdcCommandAmount(withdrawalAmount)} USDC`,
        detail: "A separate-session withdrawal to the untouched Base payout wallet.",
        confirmation: bridgeConfirmation("withdraw", withdrawalAmount),
        amount: usdcCommandAmount(withdrawalAmount),
      },
    ];
  }

  return [];
}

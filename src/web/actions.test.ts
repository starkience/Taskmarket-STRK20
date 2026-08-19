import { describe, expect, it } from "vitest";
import { deriveDashboardActions } from "./actions";
import type { Snapshot } from "./steps";

const empty: Snapshot = {
  task: {
    id: null,
    requester: null,
    worker: null,
    reward: null,
    status: null,
    description: null,
    submitted: false,
    settled: false,
    escrowTxHash: null,
  },
  baseUsdc: 0n,
  payoutUsdc: 0n,
  transfer: null,
  privateUsdc: 0n,
  deposit: null,
  withdrawal: null,
};

const snap = (o: Partial<Snapshot>): Snapshot => ({ ...empty, ...o });

describe("dashboard actions", () => {
  it("offers submission, then acceptance, with exact TaskMarket phrases", () => {
    const submit = deriveDashboardActions(
      snap({ task: { ...empty.task, id: "0xtask" } }),
      Date.now(),
    );
    expect(submit[0]).toMatchObject({ id: "submit", confirmation: "SUBMIT 0xtask" });

    const accept = deriveDashboardActions(
      snap({
        task: { ...empty.task, id: "0xtask", submitted: true, worker: "0xworker" },
      }),
      Date.now(),
    );
    expect(accept[0]).toMatchObject({
      id: "accept",
      confirmation: "ACCEPT 0xtask FOR 0xworker",
    });
  });

  it("offers a five-USDC deposit only after payout", () => {
    const actions = deriveDashboardActions(
      snap({ task: { ...empty.task, settled: true }, baseUsdc: 5_087_500n }),
      Date.now(),
    );
    expect(actions[0]).toMatchObject({ id: "deposit", confirmation: "deposit 5 USDC" });
  });

  it("replaces a fresh deposit with resume whenever an inbound cursor exists", () => {
    const actions = deriveDashboardActions(
      snap({
        task: { ...empty.task, settled: true },
        baseUsdc: 5_087_500n,
        transfer: { direction: "into-pool", phase: "cctp-mint-in", amountWei: 5_000_000n },
      }),
      Date.now(),
    );
    expect(actions).toEqual([
      expect.objectContaining({ id: "resume-deposit", confirmation: "deposit 5 USDC" }),
    ]);
  });

  it("does not expose withdrawal in the deposit dashboard session", () => {
    const depositTime = new Date("2026-08-18T13:00:00Z");
    const snapshot = snap({
      privateUsdc: 4_980_000n,
      deposit: {
        burnTxHash: "0xburn",
        poolTxHash: "0xpool",
        amountNet: 4_980_000n,
        completedAt: depositTime.toISOString(),
      },
    });
    expect(deriveDashboardActions(snapshot, depositTime.getTime() - 1)).toEqual([]);
    expect(deriveDashboardActions(snapshot, depositTime.getTime() + 1)[0]).toMatchObject({
      id: "withdraw",
      confirmation: "withdraw 4.5 USDC",
    });
  });

  it("offers only resume after an outbound burn", () => {
    const actions = deriveDashboardActions(
      snap({
        privateUsdc: 4_980_000n,
        transfer: { direction: "from-pool", phase: "cash-out", amountWei: 4_500_000n },
      }),
      Date.now(),
    );
    expect(actions[0]).toMatchObject({
      id: "resume-withdraw",
      confirmation: "withdraw 4.5 USDC",
    });
  });
});

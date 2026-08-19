import { describe, expect, it } from "vitest";
import { deriveSteps, formatUsdc, overallProgress, type Snapshot } from "./steps";

const emptyTask: Snapshot["task"] = {
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

const empty: Snapshot = {
  task: emptyTask,
  baseUsdc: null,
  payoutUsdc: null,
  transfer: null,
  privateUsdc: null,
  deposit: null,
  withdrawal: null,
};

const snapshot = (o: Partial<Snapshot> = {}): Snapshot => ({ ...empty, ...o });
const task = (o: Partial<Snapshot["task"]> = {}): Snapshot["task"] => ({ ...emptyTask, ...o });

describe("formatUsdc", () => {
  it("renders base units at two places and misses as a dash", () => {
    expect(formatUsdc(1_850_000n)).toBe("1.85 USDC");
    expect(formatUsdc(0n)).toBe("0.00 USDC");
    expect(formatUsdc(null)).toBe("—");
  });
});

describe("deriveSteps", () => {
  it("shows all ten checkpoints and no invented progress on a fresh run", () => {
    const steps = deriveSteps(empty);
    expect(steps).toHaveLength(10);
    expect(steps.every((step) => step.state === "pending")).toBe(true);
    expect(overallProgress(steps)).toBe(0);
  });

  it("makes submission active once the bounty is escrowed", () => {
    const steps = deriveSteps(
      snapshot({
        task: task({
          id: "0xbounty",
          reward: 5_500_000n,
          escrowTxHash: "0xescrow",
          description: "Explain the STRK20 privacy boundary.",
        }),
      }),
    );
    expect(steps[0]?.state).toBe("done");
    expect(steps[0]?.detail).toBe("5.50 USDC locked");
    expect(steps[0]?.content).toBe("Explain the STRK20 privacy boundary.");
    expect(steps[1]?.state).toBe("active");
  });

  it("moves from submission to payout without treating an unread balance as proof", () => {
    const steps = deriveSteps(
      snapshot({ task: task({ id: "0xbounty", submitted: true, worker: "0xworker" }) }),
    );
    expect(steps[1]?.state).toBe("done");
    expect(steps[2]?.state).toBe("active");
    expect(steps[2]?.detail).toMatch(/unread/);
  });

  it("treats an inbound cursor as proof of the Base burn only", () => {
    const steps = deriveSteps(
      snapshot({
        task: task({ settled: true }),
        transfer: { direction: "into-pool", phase: "cctp-mint-in", amountWei: 1n },
      }),
    );
    expect(steps[3]?.state).toBe("done");
    expect(steps[4]?.state).toBe("active");
    expect(steps[5]?.state).toBe("pending");
  });

  it("makes the privacy wait the sole active checkpoint after deposit", () => {
    const steps = deriveSteps(snapshot({ privateUsdc: 5_000_000n }));
    expect(steps.slice(3, 6).map((step) => step.state)).toEqual(["done", "done", "done"]);
    expect(steps[6]?.state).toBe("active");
    expect(steps[7]?.state).toBe("pending");
  });

  it("shows the Base mint active for an outbound cursor", () => {
    const steps = deriveSteps(
      snapshot({ transfer: { direction: "from-pool", phase: "cash-out", amountWei: 1n } }),
    );
    expect(steps[7]?.state).toBe("done");
    expect(steps[8]?.state).toBe("done");
    expect(steps[9]?.state).toBe("active");
  });

  it("completes only from a durable withdrawal receipt", () => {
    const steps = deriveSteps(
      snapshot({
        payoutUsdc: 4_900_000n,
        withdrawal: {
          burnTxHash: "0xburn",
          forwardTxHash: "0xmint",
          destination: "0x1111111111111111111111111111111111111111",
          amountNet: 4_900_000n,
        },
      }),
    );
    expect(steps[9]?.state).toBe("done");
    expect(steps[9]?.detail).toContain("4.90 USDC");
    expect(steps[9]?.txHash).toBe("0xmint");
  });
});

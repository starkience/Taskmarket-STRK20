import { describe, expect, it } from "vitest";
import { parseEarnedTask, validateTaskId } from "./taskmarket";

const id = `0x${"a".repeat(64)}`;
const worker = `0x${"b".repeat(40)}`;
const other = `0x${"c".repeat(40)}`;

function task(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      id,
      chainId: 8453,
      status: "completed",
      reward: "5000000",
      awards: [
        { workerAddress: worker, workerPayment: "2100000", settlementTxHash: "0xsettled" },
        { workerAddress: other, workerPayment: "2700000" },
      ],
      ...overrides,
    },
  };
}

describe("Taskmarket completed earnings", () => {
  it("uses only the agent's event-backed Base award", () => {
    const result = parseEarnedTask(task(), id, worker.toUpperCase());
    expect(result).toMatchObject({
      id,
      workerPayment: 2_100_000n,
      settled: true,
      source: "external",
    });
  });

  it("rejects other chains, unpaid tasks, and wallets with no award", () => {
    expect(() => parseEarnedTask(task({ chainId: 4217 }), id, worker)).toThrow(/Base mainnet/);
    expect(() => parseEarnedTask(task({ status: "open" }), id, worker)).toThrow(/completed payout/);
    expect(() => parseEarnedTask(task(), id, `0x${"d".repeat(40)}`)).toThrow(/did not receive/);
  });

  it("refuses malformed awards and normalizes valid task IDs", () => {
    expect(() => parseEarnedTask(task({ awards: [] }), id, worker)).toThrow(/did not receive/);
    expect(() => parseEarnedTask(task({ awards: [{ workerAddress: worker, workerPayment: "2.1" }] }), id, worker)).toThrow(/invalid worker payment/);
    expect(validateTaskId(id.toUpperCase().replace(/^0X/, "0x"))).toBe(id);
  });
});

import { describe, expect, it, vi } from "vitest";
import { makeEvmSender } from "./evmSender";

const CTX = { chainId: 8453, account: "0x1111111111111111111111111111111111111111" as const };
const call = (to: string) => ({ to: to as `0x${string}`, data: "0x00" as `0x${string}` });

describe("evmSender", () => {
  it("submits calls in order and reports the last hash", async () => {
    const sent: string[] = [];
    const send = vi.fn(async (c: { to: string }) => {
      sent.push(c.to);
      return `0xhash${sent.length}` as `0x${string}`;
    });
    const sender = makeEvmSender({ send, wait: async () => ({ success: true }) });

    const result = await sender([call("0xaaa"), call("0xbbb")], CTX);

    expect(sent).toEqual(["0xaaa", "0xbbb"]);
    expect(result).toEqual({ txHash: "0xhash2", success: true });
  });

  it("waits for each receipt before sending the next call", async () => {
    // An approval must be mined before the burn that depends on it is submitted.
    const order: string[] = [];
    const sender = makeEvmSender({
      send: async (c: { to: string }) => {
        order.push(`send:${c.to}`);
        return "0xhash" as `0x${string}`;
      },
      wait: async () => {
        order.push("wait");
        return { success: true };
      },
    });

    await sender([call("0xaaa"), call("0xbbb")], CTX);

    expect(order).toEqual(["send:0xaaa", "wait", "send:0xbbb", "wait"]);
  });

  it("reserves one nonce and increments it locally across a call group", async () => {
    const usedNonces: Array<number | undefined> = [];
    const nextNonce = vi.fn(async () => 17);
    const sender = makeEvmSender({
      nextNonce,
      send: async (_call, ctx) => {
        usedNonces.push(ctx.nonce);
        return `0xhash${usedNonces.length}` as `0x${string}`;
      },
      wait: async () => ({ success: true }),
    });

    await sender([call("0xaaa"), call("0xbbb")], CTX);

    expect(nextNonce).toHaveBeenCalledOnce();
    expect(usedNonces).toEqual([17, 18]);
  });

  it("stops at the first reverted call", async () => {
    // Continuing past a reverted approval would submit a burn that cannot succeed.
    const send = vi.fn(async () => "0xhash" as `0x${string}`);
    const sender = makeEvmSender({ send, wait: async () => ({ success: false }) });

    await expect(sender([call("0xaaa"), call("0xbbb")], CTX)).rejects.toThrow(/revert/i);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty batch rather than reporting a hashless success", async () => {
    const sender = makeEvmSender({
      send: async () => "0xhash" as `0x${string}`,
      wait: async () => ({ success: true }),
    });
    await expect(sender([], CTX)).rejects.toThrow(/no calls/i);
  });
});

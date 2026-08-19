import { describe, expect, it } from "vitest";
import { checkDestination, looksFeeShaped } from "./withdraw";

const AGENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const FRESH = "0x1111111111111111111111111111111111111111";

describe("withdrawal destination", () => {
  it("accepts a fresh EVM address", () => {
    expect(checkDestination(FRESH, AGENT)).toBe(FRESH);
  });

  it("rejects anything that is not an EVM address", () => {
    // A Starknet address here would burn toward an unspendable recipient.
    expect(() => checkDestination("0x123", AGENT)).toThrow(/EVM address/);
    expect(() =>
      checkDestination("0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a", AGENT),
    ).toThrow(/EVM address/);
    expect(() => checkDestination("", AGENT)).toThrow(/EVM address/);
  });

  it("refuses the agent's own funding EOA, in any case", () => {
    // Paying out to the funding address joins the two public edges the pool
    // exists to separate.
    expect(() => checkDestination(AGENT, AGENT)).toThrow(/fresh address/);
    expect(() => checkDestination(AGENT.toLowerCase(), AGENT)).toThrow(/fresh address/);
  });
});

describe("fee-shaped amounts", () => {
  it("flags a residue that would fingerprint the withdrawal", () => {
    // 10 USDC bounty -> 9.25 after platform fee -> minus the pool fee.
    expect(looksFeeShaped("8.917431")).toBe(true);
    expect(looksFeeShaped("9.2513")).toBe(true);
  });

  it("accepts round amounts, which sit in a crowd", () => {
    for (const amount of ["1", "1.0", "0.5", "10.00", "2.25"]) {
      expect(looksFeeShaped(amount)).toBe(false);
    }
  });
});

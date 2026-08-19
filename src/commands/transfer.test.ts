import { describe, expect, it } from "vitest";
import { checkStarknetRecipient } from "./transfer";

const SN = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

describe("transfer recipient", () => {
  it("accepts a Starknet address", () => {
    // Normalization proper needs bridge-core config, so it happens in transfer();
    // this guard is the pure paste check.
    expect(checkStarknetRecipient(SN)).toBe(SN);
  });

  it("rejects an EVM-shaped address", () => {
    // A 20-byte address is a valid felt, so the pool would accept it and send the
    // note somewhere nobody controls on Starknet.
    expect(() => checkStarknetRecipient("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toThrow(
      /EVM address/,
    );
  });

  it("points an EVM-shaped address at the right command", () => {
    expect(() => checkStarknetRecipient("0x1111111111111111111111111111111111111111")).toThrow(
      /withdraw/,
    );
  });
});

import { describe, expect, it } from "vitest";
import { confirmOrThrow, expectedPhrase, formatConfirmation } from "./confirm";

const request = {
  action: "deposit",
  wallet: "0x1111111111111111111111111111111111111111",
  amount: "1.000000 USDC",
  network: "Base mainnet (8453)",
};

describe("confirmation gate", () => {
  it("shows wallet, amount and network to the operator", () => {
    const text = formatConfirmation(request);
    expect(text).toContain("0x1111111111111111111111111111111111111111");
    expect(text).toContain("1.000000 USDC");
    expect(text).toContain("Base mainnet (8453)");
  });

  it("requires the exact phrase", () => {
    expect(expectedPhrase(request)).toBe("deposit 1.000000 USDC");
    expect(() => confirmOrThrow(request, "deposit 1.000000 USDC")).not.toThrow();
    expect(() => confirmOrThrow(request, "  deposit 1.000000 USDC  ")).not.toThrow();
  });

  it("aborts on a wrong, partial, empty or differently-cased answer", () => {
    expect(() => confirmOrThrow(request, "yes")).toThrow(/aborted/i);
    expect(() => confirmOrThrow(request, "deposit")).toThrow(/aborted/i);
    expect(() => confirmOrThrow(request, "")).toThrow(/aborted/i);
    expect(() => confirmOrThrow(request, "DEPOSIT 1.000000 USDC")).toThrow(/aborted/i);
  });
});

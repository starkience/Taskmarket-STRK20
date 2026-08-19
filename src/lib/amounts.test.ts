import { describe, expect, it } from "vitest";
import { formatUnits, parseUnits } from "./amounts";

describe("USDC amount helpers", () => {
  it("parses six-decimal values exactly", () => {
    expect(parseUnits("1.234567", 6)).toBe(1_234_567n);
    expect(parseUnits("10", 6)).toBe(10_000_000n);
  });

  it("rejects ambiguous or over-precise inputs", () => {
    expect(() => parseUnits("1.0000001", 6)).toThrow(/six|6 decimal/i);
    expect(() => parseUnits("1e6", 6)).toThrow();
    expect(() => parseUnits("0", 6)).toThrow();
  });

  it("formats without floating-point arithmetic", () => {
    expect(formatUnits(1_234_500n, 6)).toBe("1.2345");
    expect(formatUnits(null, 6)).toBe("—");
  });
});

export function parseUnits(value: string, decimals: number): bigint {
  const clean = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(clean)) {
    throw new Error("Enter a positive decimal amount.");
  }
  // The regex above guarantees a whole part; the default only satisfies the compiler.
  const [whole = "0", fraction = ""] = clean.split(".");
  if (fraction.length > decimals) {
    throw new Error(`USDC supports at most ${decimals} decimal places.`);
  }
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw <= 0n) throw new Error("Amount must be greater than zero.");
  return raw;
}

export function formatUnits(value: bigint | null, decimals: number, places = 6): string {
  if (value === null) return "—";
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(decimals, "0").slice(0, places).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Successful bridge receipts contain public transaction metadata only. Keeping
// them after bridge-core clears its safety cursor lets the read-only dashboard
// prove completion without guessing from a zero balance.
export function writePublicReceipt(
  env: Record<string, string | undefined>,
  name: "deposit-receipt.json" | "withdrawal-receipt.json",
  receipt: Record<string, string | null>,
): void {
  const dir = resolve(env.TASKMARKET_STATE_DIR?.trim() || "live/.state");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, name),
    `${JSON.stringify({ ...receipt, completedAt: new Date().toISOString() }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

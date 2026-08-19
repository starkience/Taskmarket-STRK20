import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTaskMarketState } from "./snapshot";

describe("readTaskMarketState", () => {
  it("unwraps CLI responses and ignores unrelated JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "strk20-dashboard-"));
    writeFileSync(
      join(dir, "before-submit.json"),
      JSON.stringify({
        ok: true,
        data: {
          id: "0xtask",
          requester: "0xrequester",
          reward: "5500000",
          status: "open",
          description: "Write the privacy report.",
          escrowTxHash: "0xescrow",
          submissionCount: 0,
        },
      }),
    );
    writeFileSync(join(dir, "taskmarket-worker-keystore.json"), JSON.stringify({ id: "must-not-read" }));

    const state = readTaskMarketState(dir);
    expect(state.id).toBe("0xtask");
    expect(state.reward).toBe(5_500_000n);
    expect(state.escrowTxHash).toBe("0xescrow");
    expect(state.description).toBe("Write the privacy report.");
    expect(state.submitted).toBe(false);
  });

  it("uses the guarded runner markers for submission and settlement", () => {
    const dir = mkdtempSync(join(tmpdir(), "strk20-dashboard-"));
    writeFileSync(join(dir, "create.json"), JSON.stringify({ ok: true, data: { taskId: "0xtask" } }));
    writeFileSync(join(dir, "submit.json"), JSON.stringify({ ok: true, data: { submissionId: "1" } }));
    writeFileSync(join(dir, "worker-address.txt"), "0xworker\n");
    writeFileSync(join(dir, "accept.json"), JSON.stringify({ ok: true, data: { accepted: true } }));

    const state = readTaskMarketState(dir);
    expect(state).toMatchObject({ id: "0xtask", worker: "0xworker", submitted: true, settled: true });
  });
});

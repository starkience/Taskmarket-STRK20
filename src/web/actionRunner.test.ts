import { describe, expect, it } from "vitest";
import { redactActionOutput } from "./actionRunner";

describe("dashboard action output redaction", () => {
  it("removes configured secret-bearing endpoints and keys", () => {
    const env = {
      BASE_RPC_URL: "https://example.invalid/v2/not-a-real-key",
      WORKER_EVM_PRIVATE_KEY: `0x${"11".repeat(32)}`,
    };
    const raw = `URL: ${env.BASE_RPC_URL}\nkey: ${env.WORKER_EVM_PRIVATE_KEY}`;

    const result = redactActionOutput(raw, env);

    expect(result).not.toContain("not-a-real-key");
    expect(result).not.toContain(env.WORKER_EVM_PRIVATE_KEY);
    expect(result).toContain("[redacted BASE_RPC_URL]");
    expect(result).toContain("[redacted WORKER_EVM_PRIVATE_KEY]");
  });

  it("removes signed payloads while preserving ordinary transaction hashes", () => {
    const txHash = `0x${"ab".repeat(32)}`;
    const signedPayload = `0x${"cd".repeat(200)}`;

    const result = redactActionOutput(`hash ${txHash}\nraw ${signedPayload}`, {});

    expect(result).toContain(txHash);
    expect(result).not.toContain(signedPayload);
    expect(result).toContain("0x[redacted signed payload]");
  });
});

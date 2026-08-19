import { describe, expect, it } from "vitest";
import { IDENTITY_MESSAGE, deriveSignature, loadAgentAccount, loadPayoutAddress } from "./identity";

// Well-known throwaway test key from the hardhat/anvil default set. Never used for funds.
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("agent identity", () => {
  it("loads an account from the env key", () => {
    const account = loadAgentAccount({ AGENT_EVM_PRIVATE_KEY: KEY });
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("produces a stable signature over the identity message", async () => {
    const account = loadAgentAccount({ AGENT_EVM_PRIVATE_KEY: KEY });
    const first = await deriveSignature(account);
    const second = await deriveSignature(account);
    expect(first).toBe(second);
    expect(first).toMatch(/^0x[0-9a-f]{130}$/);
    expect(IDENTITY_MESSAGE.length).toBeGreaterThan(0);
  });

  it("rejects a missing or malformed key", () => {
    expect(() => loadAgentAccount({})).toThrow(/AGENT_EVM_PRIVATE_KEY/);
    expect(() => loadAgentAccount({ AGENT_EVM_PRIVATE_KEY: "not-a-key" })).toThrow(/64 hex/);
    expect(() => loadAgentAccount({ AGENT_EVM_PRIVATE_KEY: KEY.slice(0, 20) })).toThrow(/64 hex/);
  });

  it("resolves the payout address from its own key", () => {
    // Independent of the funding key on purpose: deriving it would tie the
    // agent's public worker identity to where its earnings land.
    // Another well-known anvil key, unrelated to KEY above. Never used for funds.
    const payout = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
    const address = loadPayoutAddress({ AGENT_PAYOUT_PRIVATE_KEY: payout });
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(address).not.toBe(loadAgentAccount({ AGENT_EVM_PRIVATE_KEY: KEY }).address);
  });

  it("points at the generator when the payout key is missing or malformed", () => {
    expect(() => loadPayoutAddress({})).toThrow(/new-payout-key/);
    expect(() => loadPayoutAddress({ AGENT_PAYOUT_PRIVATE_KEY: "nope" })).toThrow(/64 hex/);
  });

  it("never puts key material in the error message", () => {
    const bad = `0x${"a".repeat(63)}`;
    try {
      loadAgentAccount({ AGENT_EVM_PRIVATE_KEY: bad });
      throw new Error("should have thrown");
    } catch (error) {
      expect(String(error)).not.toContain("aaaa");
    }
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MAINNET_POOL_ADDRESS, initAgentBridge, requiredEnv } from "./initBridge";

const OZ = "0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    NETWORK: "mainnet",
    STARKNET_RPC_URL: "https://rpc.example",
    BASE_RPC_URL: "https://base.example",
    PROVER_URL: "https://prover.example",
    INDEXER_URL: "https://indexer.example",
    OZ_ACCOUNT_CLASS_HASH_MAINNET: OZ,
    ...overrides,
  };
}

describe("initAgentBridge", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses to run against anything but mainnet", () => {
    // bridge-core silently defaults NETWORK to 'testnet', which would point the
    // agent at the Sepolia pool. Refuse rather than inherit that default.
    expect(() => initAgentBridge(env({ NETWORK: undefined }))).toThrow(/NETWORK/);
    expect(() => initAgentBridge(env({ NETWORK: "testnet" }))).toThrow(/mainnet/);
  });

  it("fails loudly when a required variable is missing", () => {
    for (const key of requiredEnv) {
      expect(() => initAgentBridge(env({ [key]: undefined }))).toThrow(new RegExp(key));
    }
  });

  it("resolves the mainnet pool and the on-chain proof validity window", () => {
    const config = initAgentBridge(env({ PROOF_VALIDITY_BLOCKS: "400" }));
    expect(BigInt(config.poolAddress)).toBe(BigInt(MAINNET_POOL_ADDRESS));
    expect(config.proofValidityBlocks).toBe(400);
    expect(BigInt(config.ozClassHash)).toBe(BigInt(OZ));
  });

  it("routes bridge-core's relative service paths through the shim", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        seen.push(String(input));
        return new Response("{}");
      }),
    );
    initAgentBridge(env());
    await fetch("/prover");
    expect(seen).toEqual(["https://prover.example"]);
  });

  it("installs the burn-cursor storage before bridge-core can touch it", () => {
    // Without this, bridge-core's cursor reads are swallowed in Node, every burn
    // looks fresh, and a retried deposit burns real USDC twice.
    const file = join(mkdtempSync(join(tmpdir(), "init-state-")), "s.json");
    initAgentBridge(env({ AGENT_STATE_FILE: file }));
    globalThis.localStorage.setItem("pmp.inflightBurn", "{}");
    expect(existsSync(file)).toBe(true);
  });

  it("gives bridge-core absolute service URLs", () => {
    // starknet.js validates nodeUrl at construction and falls back to its own
    // public node before fetch is reached, so a relative "/rpc" would send reads
    // to a node nobody configured — silently.
    const config = initAgentBridge(env());
    expect(config.rpcUrl).toBe("https://rpc.example");
    expect(config.proverUrl).toBe("https://prover.example");
    expect(config.indexerUrl).toBe("https://indexer.example");
  });

  it("gives bridge-core an RPC version that supports pre_confirmed reads", () => {
    const config = initAgentBridge(
      env({
        STARKNET_RPC_URL:
          "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_8/redacted-key",
      }),
    );
    expect(config.rpcUrl).toContain("/rpc/v0_9/");
  });

  it("never lets bridge-core build a dev network suffix", () => {
    // With dev=true bridge-core would build '/rpc/mainnet' before the override.
    const config = initAgentBridge({ ...env(), DEV: "1" });
    expect(config.rpcUrl).toBe("https://rpc.example");
  });
});

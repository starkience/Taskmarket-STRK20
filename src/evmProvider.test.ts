import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { BASE_CHAIN_ID, makeAgentProvider } from "./evmProvider";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount(KEY);

function provider(overrides: Partial<Parameters<typeof makeAgentProvider>[0]> = {}) {
  return makeAgentProvider({
    account,
    chainId: BASE_CHAIN_ID,
    getTransactionByHash: vi.fn(async () => ({ hash: "0xtx" })),
    getTransactionReceipt: vi.fn(async () => ({ status: "0x1" })),
    ...overrides,
  });
}

describe("agent EIP-1193 provider", () => {
  it("reports the configured chain as hex", async () => {
    expect(await provider().request({ method: "eth_chainId" })).toBe("0x2105");
    expect(BASE_CHAIN_ID).toBe(8453);
  });

  it("exposes only the agent account", async () => {
    for (const method of ["eth_accounts", "eth_requestAccounts"]) {
      expect(await provider().request({ method })).toEqual([account.address]);
    }
  });

  it("signs with personal_sign", async () => {
    const sig = await provider().request({
      method: "personal_sign",
      params: ["0xdeadbeef", account.address],
    });
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("accepts a switch to its own chain and refuses any other", async () => {
    // Silently accepting a foreign chain would let bridge-core believe it had
    // moved networks while the agent kept signing on Base.
    await expect(
      provider().request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] }),
    ).resolves.toBeNull();
    await expect(
      provider().request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }),
    ).rejects.toThrow(/chain/i);
  });

  it("delegates transaction reads to the RPC", async () => {
    const getTransactionReceipt = vi.fn(async () => ({ status: "0x1" }));
    const p = provider({ getTransactionReceipt });
    expect(await p.request({ method: "eth_getTransactionReceipt", params: ["0xabc"] })).toEqual({
      status: "0x1",
    });
    expect(getTransactionReceipt).toHaveBeenCalledWith("0xabc");
  });

  it("rejects any method it does not implement", async () => {
    // Returning undefined for an unknown method would surface as a confusing
    // downstream failure instead of naming the gap.
    await expect(provider().request({ method: "eth_sendTransaction" })).rejects.toThrow(
      /eth_sendTransaction/,
    );
  });
});

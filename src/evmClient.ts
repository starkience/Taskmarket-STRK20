import { createPublicClient, createWalletClient, http, type PrivateKeyAccount } from "viem";
import { base } from "viem/chains";
import { BASE_CHAIN_ID, makeAgentProvider, type Eip1193Provider } from "./evmProvider";
import { makeEvmSender, type EvmCall, type TxRunner } from "./evmSender";

export interface AgentEvm {
  provider: Eip1193Provider;
  evmSender: ReturnType<typeof makeEvmSender>;
}

// Wires the two seams bridge-core needs from a local key: an EIP-1193 provider
// for chain resolution and receipt polling, and a sender that actually submits.
export function makeAgentEvm(account: PrivateKeyAccount, rpcUrl?: string): AgentEvm {
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({ account, chain: base, transport });

  const runner: TxRunner = {
    async nextNonce() {
      return publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
    },
    async send(call: EvmCall, ctx) {
      return walletClient.sendTransaction({
        to: call.to,
        data: call.data,
        value: call.value ?? 0n,
        ...(ctx.nonce === undefined ? {} : { nonce: ctx.nonce }),
      });
    },
    async wait(hash) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { success: receipt.status === "success" };
    },
  };

  return {
    provider: makeAgentProvider({
      account,
      chainId: BASE_CHAIN_ID,
      getTransactionByHash: (hash) => publicClient.request({
        method: "eth_getTransactionByHash",
        params: [hash as `0x${string}`],
      }),
      getTransactionReceipt: (hash) => publicClient.request({
        method: "eth_getTransactionReceipt",
        params: [hash as `0x${string}`],
      }),
    }),
    evmSender: makeEvmSender(runner),
  };
}

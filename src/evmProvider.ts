import type { PrivateKeyAccount } from "viem";

export const BASE_CHAIN_ID = 8453;

export interface Eip1193Request {
  readonly method: string;
  readonly params?: readonly unknown[];
}

export interface Eip1193Provider {
  request(args: Eip1193Request): Promise<unknown>;
  // A local key emits no wallet events, but bridge-core's EthereumProvider type
  // requires the listener pair, so they are present and inert.
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

export interface AgentProviderOptions {
  account: PrivateKeyAccount;
  chainId: number;
  getTransactionByHash: (hash: string) => Promise<unknown>;
  getTransactionReceipt: (hash: string) => Promise<unknown>;
}

// bridge-core drives an EIP-1193 wallet for chain resolution and receipt polling
// even when an evmSender submits the transactions. This is the smallest adapter
// that satisfies it from a local key: exactly the methods bridge-core calls, and
// a loud failure for anything else.
export function makeAgentProvider(options: AgentProviderOptions): Eip1193Provider {
  const { account, chainId, getTransactionByHash, getTransactionReceipt } = options;
  const hexChainId = `0x${chainId.toString(16)}`;

  return {
    on() {},
    removeListener() {},

    async request({ method, params }: Eip1193Request): Promise<unknown> {
      switch (method) {
        case "eth_chainId":
          return hexChainId;

        case "eth_accounts":
        case "eth_requestAccounts":
          return [account.address];

        case "personal_sign": {
          const data = params?.[0];
          if (typeof data !== "string") {
            throw new Error("personal_sign: expected hex data as the first parameter.");
          }
          return account.signMessage({ message: { raw: data as `0x${string}` } });
        }

        case "wallet_switchEthereumChain": {
          const target = (params?.[0] as { chainId?: string } | undefined)?.chainId;
          // Accepting a foreign chain would let bridge-core believe it had moved
          // networks while this agent kept signing on its one chain.
          if (typeof target !== "string" || BigInt(target) !== BigInt(hexChainId)) {
            throw new Error(
              `This agent is pinned to chain ${hexChainId}; refusing to switch to ${String(target)}.`,
            );
          }
          return null;
        }

        case "wallet_addEthereumChain":
          return null;

        case "eth_getTransactionByHash":
        case "eth_getTransactionReceipt": {
          const hash = params?.[0];
          if (typeof hash !== "string") {
            throw new Error(`${method}: expected a transaction hash.`);
          }
          return method === "eth_getTransactionByHash"
            ? getTransactionByHash(hash)
            : getTransactionReceipt(hash);
        }

        default:
          throw new Error(`Agent provider does not implement ${method}.`);
      }
    },
  };
}

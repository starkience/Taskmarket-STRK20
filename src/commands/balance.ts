import { discoverPrivateBalance, getStrkBalance } from "@starkware-libs/starknet-privacy-bridge";
import {
  deriveStarknetAccount,
  deriveStarknetPrivateKey,
  deriveViewingKey,
} from "@starkware-libs/starknet-privacy-bridge";
import { Account, RpcProvider } from "starknet";
import { formatUnits } from "../lib/amounts";
import { deriveSignature, loadAgentAccount } from "../identity";
import { requireRpcUrl } from "../serviceFetch";

const USDC_DECIMALS = 6;
const STRK_DECIMALS = 18;

export interface BalanceDeps {
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  ozClassHash: string;
}

// Read-only, so no confirmation gate. The viewing key is derived in memory from
// the identity signature and never persisted.
export async function balance(deps: BalanceDeps): Promise<void> {
  const { env, log, ozClassHash } = deps;
  const signature = await deriveSignature(loadAgentAccount(env));

  const privateKey = deriveStarknetPrivateKey(signature);
  const viewingKey = deriveViewingKey(signature);
  const derived = deriveStarknetAccount(privateKey, ozClassHash);

  log(`  starknet account: ${derived.address}`);

  // The absolute URL, not the shim's "/rpc": starknet.js rejects a relative
  // nodeUrl and silently falls back to a public node.
  const provider = new RpcProvider({ nodeUrl: requireRpcUrl(env) });
  // starknet.js logs "Using default public node url" here. That is the Account's
  // DEFAULT PAYMASTER, not the provider above — this account only reads, and
  // nothing is ever submitted through it. Do not read it as a bad RPC.
  const account = new Account({ provider, address: derived.address, signer: privateKey });

  const strk = await getStrkBalance(derived.address);
  log(`  public STRK:      ${formatUnits(strk, STRK_DECIMALS)}`);

  const priv = await discoverPrivateBalance({ account, viewingKey });
  log(`  private USDC:     ${formatUnits(priv, USDC_DECIMALS)}`);
}

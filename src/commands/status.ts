import {
  deriveStarknetAccount,
  deriveStarknetPrivateKey,
  getBridgeTransferStatusAsync,
} from "@starkware-libs/starknet-privacy-bridge";
import { formatUnits } from "../lib/amounts";
import { deriveSignature, loadAgentAccount } from "../identity";

const USDC_DECIMALS = 6;

export interface StatusDeps {
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  ozClassHash: string;
}

// Read-only. Reports any transfer bridge-core still considers in flight, which is
// what a resumed run would pick up — so this is the command to check BEFORE
// re-running a deposit or withdrawal that appeared to fail.
export async function status(deps: StatusDeps): Promise<void> {
  const { env, log, ozClassHash } = deps;
  const account = loadAgentAccount(env);
  const signature = await deriveSignature(account);
  const derived = deriveStarknetAccount(deriveStarknetPrivateKey(signature), ozClassHash);

  const inFlight = await getBridgeTransferStatusAsync({
    snAddress: derived.address,
    evmAddress: account.address,
  });

  log(`  base EOA:         ${account.address}`);
  log(`  starknet account: ${derived.address}`);

  if (!inFlight) {
    log("  in flight:        none");
    return;
  }

  log(`  in flight:        ${inFlight.direction} / ${inFlight.phase}`);
  log(`  amount:           ${formatUnits(inFlight.amountWei, USDC_DECIMALS)} USDC`);
  log(`  needs signature:  ${inFlight.needsSignature ? "yes" : "no"}`);
  log("");
  log("  A transfer is still in flight. Resume it rather than starting a new one:");
  log("  re-running the same command picks up this burn instead of issuing another.");
}

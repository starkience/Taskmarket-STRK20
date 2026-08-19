import { cashOut } from "@starkware-libs/starknet-privacy-bridge";
import { formatUnits, parseUnits } from "../lib/amounts";
import { confirmOrThrow, formatConfirmation, type ConfirmRequest } from "../confirm";
import { deriveSignature, loadAgentAccount, loadPayoutAddress } from "../identity";
import { BASE_CHAIN_ID } from "../evmProvider";

const USDC_DECIMALS = 6;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// A payout is fee-shaped by construction: a 10 USDC bounty nets 9.25 after the
// platform fee, then the pool fee shaves it again. Withdrawing that exact residue
// republishes it — the amount alone links the deposit to the withdrawal, whatever
// the pool proves. Round amounts sit in a crowd; residues do not.
export function looksFeeShaped(amount: string): boolean {
  const fraction = amount.trim().split(".")[1] ?? "";
  return fraction.replace(/0+$/, "").length > 2;
}

export interface WithdrawDeps {
  env: Record<string, string | undefined>;
  ask: (prompt: string) => Promise<string>;
  log: (line: string) => void;
  record?: (receipt: {
    burnTxHash: string;
    forwardTxHash: string | null;
    destination: string;
    amountNet: string;
  }) => void;
}

// The destination must be an address the agent does not already control on the
// public side. Paying out to the funding EOA would join the two public edges the
// pool exists to separate, which silently defeats the point of the withdrawal.
export function checkDestination(destination: string, agentAddress: string): string {
  if (!EVM_ADDRESS.test(destination)) {
    throw new Error(`Destination must be a 0x-prefixed EVM address (got ${destination}).`);
  }
  if (destination.toLowerCase() === agentAddress.toLowerCase()) {
    throw new Error(
      "Destination is the agent's own funding EOA. Use a fresh address: paying out to the " +
        "funding address links the deposit and withdrawal edges.",
    );
  }
  return destination;
}

// Pool -> fresh Base address. The pool withdraws to the Anonymizer, which burns
// via CCTP toward the destination in one proven action, so no personal Starknet
// account ever holds the funds and no per-account commitment is emitted.
export async function withdraw(
  amount: string,
  destination: string | undefined,
  deps: WithdrawDeps,
): Promise<void> {
  const { env, ask, log } = deps;
  const account = loadAgentAccount(env);
  // Defaults to the agent's own payout address. An explicit destination is still
  // accepted, and still checked.
  const target = checkDestination(destination ?? loadPayoutAddress(env), account.address);
  const amountWei = parseUnits(amount, USDC_DECIMALS);

  const request: ConfirmRequest = {
    action: "withdraw",
    wallet: `pool -> ${target}`,
    amount: `${formatUnits(amountWei, USDC_DECIMALS)} USDC`,
    network: `STRK20 pool to Base mainnet (${BASE_CHAIN_ID})`,
  };
  if (looksFeeShaped(amount)) {
    log(
      `  note: ${amount} is a distinctive amount. A round withdrawal is harder to\n` +
        "        match against the deposit; consider leaving a remainder in the pool.",
    );
  }
  log(formatConfirmation(request));
  confirmOrThrow(request, await ask("> "));

  const result = await cashOut({
    resolveSignature: () => deriveSignature(account),
    amount: amountWei,
    destination: target,
    // Keys the in-flight cash-out cursor, so an interrupted run resumes the same
    // burn rather than starting a second one.
    evmAddress: account.address,
    destChainId: BASE_CHAIN_ID,
    onStep: (step, status, detail) => log(`  ${step}: ${status}${detail ? ` — ${detail}` : ""}`),
  });

  deps.record?.({
    burnTxHash: result.burnTxHash,
    forwardTxHash: result.forwardTxHash ?? null,
    destination: result.destination,
    amountNet: result.amountNet.toString(),
  });

  log(`  CCTP burn ${result.burnTxHash}`);
  log(`Withdrew ${formatUnits(result.amountNet, USDC_DECIMALS)} USDC to ${result.destination}.`);
}

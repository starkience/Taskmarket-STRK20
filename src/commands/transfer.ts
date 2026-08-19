import {
  normalizeStarknetRecipient,
  sendPrivateToStarknet,
} from "@starkware-libs/starknet-privacy-bridge";
import { formatUnits, parseUnits } from "../lib/amounts";
import { confirmOrThrow, formatConfirmation, type ConfirmRequest } from "../confirm";
import { deriveSignature, loadAgentAccount } from "../identity";

const USDC_DECIMALS = 6;
const EVM_SHAPED = /^0x[0-9a-fA-F]{40}$/;

export interface TransferDeps {
  env: Record<string, string | undefined>;
  ask: (prompt: string) => Promise<string>;
  log: (line: string) => void;
}

// An EVM address is also a valid felt, so pasting a Base address here would be
// accepted by the pool and send the note to something nobody controls on
// Starknet. The length check catches that paste; it is a heuristic, so it names
// what it suspects rather than claiming the address is malformed.
export function checkStarknetRecipient(recipient: string): string {
  if (EVM_SHAPED.test(recipient)) {
    throw new Error(
      `${recipient} is 20 bytes, which looks like an EVM address. This transfer stays on ` +
        "Starknet — use the recipient's Starknet address, or `withdraw` to reach Base.",
    );
  }
  return recipient;
}

// Pool -> another pool identity. The value never leaves the pool: one proven
// apply_actions, no CCTP leg, no public Starknet edge.
export async function transfer(
  amount: string,
  recipient: string,
  deps: TransferDeps,
): Promise<void> {
  const { env, ask, log } = deps;
  const account = loadAgentAccount(env);
  // normalizeStarknetRecipient reads bridge-core config, so it runs here rather
  // than in the pure guard above.
  const target = normalizeStarknetRecipient(checkStarknetRecipient(recipient));
  const amountWei = parseUnits(amount, USDC_DECIMALS);

  const request: ConfirmRequest = {
    action: "transfer",
    wallet: `pool note -> ${target}`,
    amount: `${formatUnits(amountWei, USDC_DECIMALS)} USDC`,
    network: "inside the STRK20 pool (value does not leave)",
  };
  log(formatConfirmation(request));
  confirmOrThrow(request, await ask("> "));

  const result = await sendPrivateToStarknet({
    resolveSignature: () => deriveSignature(account),
    amount: amountWei,
    recipient: target,
    onStep: (step, status, detail) => log(`  ${step}: ${status}${detail ? ` — ${detail}` : ""}`),
  });

  log(`  tx ${result.txHash}`);
  log(
    result.confirmed
      ? `Transferred ${formatUnits(result.amount, USDC_DECIMALS)} USDC to ${result.recipient}.`
      : `Submitted ${formatUnits(result.amount, USDC_DECIMALS)} USDC to ${result.recipient}; not yet confirmed.`,
  );
}

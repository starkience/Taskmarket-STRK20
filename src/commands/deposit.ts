import { moveIntoPool } from "@starkware-libs/starknet-privacy-bridge";
import { parseUnits, formatUnits } from "../lib/amounts";
import { confirmOrThrow, formatConfirmation, type ConfirmRequest } from "../confirm";
import { deriveSignature, loadAgentAccount } from "../identity";
import { makeAgentEvm } from "../evmClient";
import { BASE_CHAIN_ID } from "../evmProvider";

const USDC_DECIMALS = 6;

export interface DepositDeps {
  env: Record<string, string | undefined>;
  ask: (prompt: string) => Promise<string>;
  log: (line: string) => void;
  resume: boolean;
  record?: (receipt: {
    burnTxHash: string | null;
    poolTxHash: string | null;
    amountNet: string;
  }) => void;
}

// Moves USDC from the agent's Base EOA into the pool: CCTP burn on Base, mint on
// Starknet, deposit into the pool. bridge-core persists the in-flight burn, so a
// retry resumes rather than burning again.
export async function deposit(amount: string, deps: DepositDeps): Promise<void> {
  const { env, ask, log, resume } = deps;
  const amountWei = parseUnits(amount, USDC_DECIMALS);
  const account = loadAgentAccount(env);

  const request: ConfirmRequest = {
    action: "deposit",
    wallet: account.address,
    amount: `${formatUnits(amountWei, USDC_DECIMALS)} USDC`,
    network: `Base mainnet (${BASE_CHAIN_ID}) into the STRK20 pool`,
  };
  log(formatConfirmation(request));
  confirmOrThrow(request, await ask("> "));

  const { provider, evmSender } = makeAgentEvm(account, env.BASE_RPC_URL);
  const signature = await deriveSignature(account);

  let burnTxHash: string | null = null;
  let poolTxHash: string | null = null;
  const result = await moveIntoPool({
    signature,
    funding: "metamask",
    amountWei,
    provider,
    evmSender,
    sourceChainId: BASE_CHAIN_ID,
    resume,
    onStep: (step, status, detail, txHash) => {
      if (step === "deposit" && txHash) poolTxHash = txHash;
      log(`  ${step}: ${status}${detail ? ` — ${detail}` : ""}${txHash ? ` — ${txHash}` : ""}`);
    },
    // Printed so an interrupted run can be resumed against the same burn rather
    // than started again.
    onBurned: (info) => {
      burnTxHash = info.burnTxHash;
      log(`  CCTP burn ${info.burnTxHash}`);
    },
  });

  if (result.deposited) {
    deps.record?.({
      burnTxHash,
      poolTxHash,
      amountNet: result.depositedNetWei.toString(),
    });
  }

  log(
    result.deposited
      ? `Deposited ${formatUnits(result.depositedNetWei, USDC_DECIMALS)} USDC (net of fees).`
      : "Already deposited by an earlier run; nothing was sent.",
  );
}

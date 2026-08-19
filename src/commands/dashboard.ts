import { Account, RpcProvider } from "starknet";
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import {
  deriveStarknetAccount,
  deriveStarknetPrivateKey,
  deriveViewingKey,
  discoverPrivateBalance,
  getBridgeTransferStatusAsync,
} from "@starkware-libs/starknet-privacy-bridge";
import { deriveSignature, loadAgentAccount, loadPayoutAddress } from "../identity";
import { requireRpcUrl } from "../serviceFetch";
import {
  readDepositReceipt,
  readTaskMarketState,
  readWithdrawalReceipt,
} from "../web/snapshot";
import { startDashboard } from "../web/server";
import { deriveDashboardActions } from "../web/actions";
import { createActionRunner } from "../web/actionRunner";
import { formatUsdc, type Snapshot } from "../web/steps";

// Base native USDC. Read directly rather than through bridge-core's Polygon
// balance helper, which would couple this Base path to that package's viem types.
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

const BALANCE_OF = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface DashboardOptions {
  env: Record<string, string | undefined>;
  log: (line: string) => void;
  ozClassHash: string;
  port: number;
}

export async function dashboard(options: DashboardOptions): Promise<void> {
  const { env, log, ozClassHash, port } = options;
  const agent = loadAgentAccount(env);
  const signature = await deriveSignature(agent);
  const privateKey = deriveStarknetPrivateKey(signature);
  const viewingKey = deriveViewingKey(signature);
  const derived = deriveStarknetAccount(privateKey, ozClassHash);
  const payout = loadPayoutAddress(env) as Address;
  const stateDir = env.TASKMARKET_STATE_DIR?.trim() || "live/.state";

  const baseClient = createPublicClient({ chain: base, transport: http(env.BASE_RPC_URL) });
  // The absolute URL, not the same-origin "/rpc": starknet.js rejects a relative
  // nodeUrl and silently falls back to a public node, which would report balances
  // read from somewhere we did not configure.
  const provider = new RpcProvider({ nodeUrl: requireRpcUrl(env) });
  // starknet.js logs "Using default public node url" here. That is the Account's
  // DEFAULT PAYMASTER, not the provider above — the dashboard only reads, and
  // nothing is ever submitted through it. Do not read it as a bad RPC.
  const snAccount = new Account({ provider, address: derived.address, signer: privateKey });

  let last: Snapshot["baseUsdc"] = null;
  let lastPayout: Snapshot["payoutUsdc"] = null;
  let lastPrivate: Snapshot["privateUsdc"] = null;

  startDashboard({
    port,
    log,
    readers: {
      task: () => readTaskMarketState(stateDir),
      baseUsdc: async () => {
        last = await baseClient.readContract({
          address: BASE_USDC,
          abi: BALANCE_OF,
          functionName: "balanceOf",
          args: [agent.address],
        });
        return last;
      },
      payoutUsdc: async () => {
        lastPayout = await baseClient.readContract({
          address: BASE_USDC,
          abi: BALANCE_OF,
          functionName: "balanceOf",
          args: [payout],
        });
        return lastPayout;
      },
      privateUsdc: async () => {
        lastPrivate = await discoverPrivateBalance({ account: snAccount, viewingKey });
        return lastPrivate;
      },
      transfer: async () => {
        const status = await getBridgeTransferStatusAsync({
          snAddress: derived.address,
          evmAddress: agent.address,
        });
        return status
          ? { direction: status.direction, phase: status.phase, amountWei: status.amountWei }
          : null;
      },
      deposit: () => readDepositReceipt(stateDir),
      withdrawal: () => readWithdrawalReceipt(stateDir),
    },
    meta: () => {
      const task = readTaskMarketState(stateDir);
      return {
        task: task.id ?? "—",
        status: task.status ?? (task.id ? "open" : "not created"),
        escrow: formatUsdc(task.reward),
        requester: task.requester ?? "—",
        worker: agent.address,
        starknet: derived.address,
        payout,
        "worker USDC": formatUsdc(last),
        "private USDC": formatUsdc(lastPrivate),
        "payout USDC": formatUsdc(lastPayout),
      };
    },
    actions: deriveDashboardActions,
    runAction: createActionRunner(env as NodeJS.ProcessEnv),
  });

  // Hold the process open; the server is the whole command.
  await new Promise<never>(() => {});
}

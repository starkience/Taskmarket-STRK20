import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  assertStarknetRpcCompatibility,
  installServiceFetch,
  readUpstreams,
} from "./serviceFetch";
import { loadAgentAccount } from "./identity";
import { deriveSignature } from "./identity";
import { initAgentBridge } from "./initBridge";
import { parseCommand } from "./commands/registry";
import { writePublicReceipt } from "./publicReceipt";
import { readEarnedTask, validateTaskId } from "./taskmarket";
import { readEarningReceipt } from "./web/snapshot";
import { formatUnits, parseUnits } from "./lib/amounts";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { deriveStarknetAccount, deriveStarknetPrivateKey, getBridgeTransferStatusAsync } from "@starkware-libs/starknet-privacy-bridge";

const BLOCKED = "Not yet implemented: see the design doc's open items.";

// The RPC has a real compatibility probe below. The indexer exposes /health;
// the prover has no documented probe, so any HTTP response proves reachability.
const PROBES = [
  ["prover", "/prover"],
  ["indexer", "/indexer/health"],
] as const;

async function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

const log = (line: string) => console.log(line);

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const BALANCE_OF = [{
  type: "function", name: "balanceOf", stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;

async function baseUsdcBalance(address: `0x${string}`): Promise<bigint> {
  const url = process.env.BASE_RPC_URL?.trim();
  if (!url) throw new Error("BASE_RPC_URL is not set.");
  const client = createPublicClient({ chain: base, transport: http(url) });
  return client.readContract({ address: BASE_USDC, abi: BALANCE_OF, functionName: "balanceOf", args: [address] });
}

async function preflight(): Promise<void> {
  const upstreams = readUpstreams(process.env);
  installServiceFetch(upstreams);
  const account = loadAgentAccount(process.env);

  const { specVersion } = await assertStarknetRpcCompatibility(upstreams.rpc);
  console.log(`  rpc: compatible (${specVersion})`);

  // Report reachability only: the upstream hostnames are confidential.
  for (const [name, path] of PROBES) {
    const response = await fetch(path, { method: "GET" }).catch(() => null);
    console.log(`  ${name}: ${response ? `reachable (${response.status})` : "unreachable"}`);
  }
  console.log(`  agent EOA: ${account.address}`);
}

async function initCompatibleBridge() {
  const config = initAgentBridge(process.env);
  await assertStarknetRpcCompatibility(config.rpcUrl);
  return config;
}

async function main(): Promise<void> {
  const { command, args } = parseCommand(process.argv.slice(2));

  switch (command) {
    case "preflight":
      return preflight();

    case "identity":
      console.log(loadAgentAccount(process.env).address);
      return;

    case "earnings": {
      const taskId = validateTaskId(args[0] ?? "");
      const account = loadAgentAccount(process.env);
      const task = await readEarnedTask(taskId, account.address);
      const balance = await baseUsdcBalance(account.address);
      const receipt = readEarningReceipt(process.env.TASKMARKET_STATE_DIR?.trim() || "live/.state", taskId);
      log(`  task:            ${taskId}`);
      log(`  worker:          ${account.address}`);
      log(`  settled payout:  ${formatUnits(task.workerPayment ?? null, 6)} USDC`);
      log(`  wallet balance:  ${formatUnits(balance, 6)} USDC`);
      log(`  shielded here:   ${receipt ? `${formatUnits(receipt.amountNet, 6)} USDC` : "not recorded"}`);
      log("  Taskmarket payout attribution is public; wallet USDC is fungible.");
      return;
    }

    case "shield": {
      const taskId = validateTaskId(args[0] ?? "");
      const amount = args[1];
      if (!amount) throw new Error("usage: npm run agent -- shield <task-id> <amount> [--resume]");
      const amountWei = parseUnits(amount, 6);
      const account = loadAgentAccount(process.env);
      const task = await readEarnedTask(taskId, account.address);
      if (amountWei > (task.workerPayment ?? 0n)) {
        throw new Error("Shield amount exceeds this task's settled worker payout.");
      }
      const stateDir = process.env.TASKMARKET_STATE_DIR?.trim() || "live/.state";
      if (readEarningReceipt(stateDir, taskId)) {
        throw new Error("This task already has a completed shielding receipt.");
      }
      const config = await initCompatibleBridge();
      const signature = await deriveSignature(account);
      const snAddress = deriveStarknetAccount(deriveStarknetPrivateKey(signature), config.ozClassHash).address;
      const inFlight = await getBridgeTransferStatusAsync({ snAddress, evmAddress: account.address });
      const resume = args.includes("--resume");
      const intentFile = resolve(stateDir, "earning-intent.json");
      let intent: { taskId?: string; amountWei?: string } | null = null;
      if (existsSync(intentFile)) {
        try {
          intent = JSON.parse(readFileSync(intentFile, "utf8")) as { taskId?: string; amountWei?: string };
        } catch {
          throw new Error("The earnings intent is unreadable. Inspect it before any bridge retry.");
        }
      }
      if (inFlight && (inFlight.direction !== "into-pool" || inFlight.amountWei !== amountWei || !resume)) {
        throw new Error("A bridge transfer is in flight. Run status and resume the same amount before starting another.");
      }
      if (inFlight && (intent?.taskId?.toLowerCase() !== taskId.toLowerCase() || intent?.amountWei !== amountWei.toString())) {
        throw new Error("The in-flight bridge transfer is not recorded for this task. Inspect status and the earnings intent.");
      }
      if (!inFlight && resume) throw new Error("No recorded deposit is available to resume.");
      if (!resume && amountWei > await baseUsdcBalance(account.address)) {
        throw new Error("Shield amount exceeds the agent's current Base USDC balance.");
      }
      if (!resume) {
        mkdirSync(dirname(intentFile), { recursive: true });
        const temp = `${intentFile}.tmp`;
        writeFileSync(temp, JSON.stringify({ taskId, amountWei: amountWei.toString() }), { mode: 0o600 });
        renameSync(temp, intentFile);
      }
      const { deposit } = await import("./commands/deposit");
      await deposit(amount, {
        env: process.env, ask, log, resume,
        record: (receipt) => {
          const earned = { ...receipt, taskId };
          writePublicReceipt(process.env, `earning-${taskId}.json`, earned);
          writePublicReceipt(process.env, "deposit-receipt.json", earned);
        },
      });
      if (readEarningReceipt(stateDir, taskId)) rmSync(intentFile, { force: true });
      return;
    }

    case "deposit": {
      const amount = args[0];
      if (!amount) throw new Error("usage: npm run agent -- deposit <amount>");
      await initCompatibleBridge();
      const { deposit } = await import("./commands/deposit");
      return deposit(amount, {
        env: process.env,
        ask,
        log,
        resume: args.includes("--resume"),
        record: (receipt) => writePublicReceipt(process.env, "deposit-receipt.json", receipt),
      });
    }

    case "withdraw": {
      const [amount, destination] = args;
      if (!amount) {
        throw new Error(
          "usage: npm run agent -- withdraw <amount> [base-address]\n" +
            "       defaults to the agent's payout address (AGENT_PAYOUT_PRIVATE_KEY)",
        );
      }
      await initCompatibleBridge();
      const { withdraw } = await import("./commands/withdraw");
      return withdraw(amount, destination, {
        env: process.env,
        ask,
        log,
        record: (receipt) => writePublicReceipt(process.env, "withdrawal-receipt.json", receipt),
      });
    }

    case "transfer": {
      const [amount, recipient] = args;
      if (!amount || !recipient) {
        throw new Error("usage: npm run agent -- transfer <amount> <starknet-recipient>");
      }
      await initCompatibleBridge();
      const { transfer } = await import("./commands/transfer");
      return transfer(amount, recipient, { env: process.env, ask, log });
    }

    case "balance": {
      const config = await initCompatibleBridge();
      const { balance } = await import("./commands/balance");
      return balance({ env: process.env, log, ozClassHash: config.ozClassHash });
    }

    case "dashboard": {
      const taskId = args[0] ? validateTaskId(args[0]) : undefined;
      const config = await initCompatibleBridge();
      const { dashboard } = await import("./commands/dashboard");
      return dashboard({
        env: taskId ? { ...process.env, TASKMARKET_TASK_ID: taskId } : process.env,
        log,
        ozClassHash: config.ozClassHash,
        port: Number(process.env.DASHBOARD_PORT ?? 4173),
      });
    }

    case "status": {
      const config = await initCompatibleBridge();
      const { status } = await import("./commands/status");
      return status({ env: process.env, log, ozClassHash: config.ozClassHash });
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

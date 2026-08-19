import { createInterface } from "node:readline/promises";
import {
  assertStarknetRpcCompatibility,
  installServiceFetch,
  readUpstreams,
} from "./serviceFetch";
import { loadAgentAccount } from "./identity";
import { initAgentBridge } from "./initBridge";
import { parseCommand } from "./commands/registry";
import { writePublicReceipt } from "./publicReceipt";

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
      const config = await initCompatibleBridge();
      const { dashboard } = await import("./commands/dashboard");
      return dashboard({
        env: process.env,
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

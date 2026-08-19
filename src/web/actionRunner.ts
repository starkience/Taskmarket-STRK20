import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { DashboardAction } from "./actions";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT_LIMIT = 64 * 1024;
// Circle Standard CCTP on Base commonly needs 15–19 minutes and can take longer
// while an OP Stack batch reaches Ethereum finality. Leave enough room for the
// subsequent Starknet mint/proof as well; the persisted cursor remains the
// recovery source if this upper bound is ever reached.
const ACTION_TIMEOUT_MS = 60 * 60 * 1000;
const SENSITIVE_ENV_NAME = /(?:PRIVATE_KEY|API_KEY|RPC_URL|PROVER_URL|INDEXER_URL)$/;
const LONG_SIGNED_PAYLOAD = /0x[0-9a-f]{128,}/gi;

export interface ActionRunResult {
  readonly output: string;
}

export function redactActionOutput(raw: string, env: NodeJS.ProcessEnv): string {
  let redacted = raw;
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < 8 || !SENSITIVE_ENV_NAME.test(name)) continue;
    redacted = redacted.replaceAll(value, `[redacted ${name}]`);
  }
  // A rejected eth_sendRawTransaction may contain the complete signed payload.
  // It is not needed for operator recovery and must not land in a screen recording.
  return redacted.replace(LONG_SIGNED_PAYLOAD, "0x[redacted signed payload]");
}

function runChild(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input?: string,
): Promise<ActionRunResult> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, [...args], {
      cwd: workspace,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let truncated = false;

    const append = (chunk: Buffer) => {
      if (output.length >= OUTPUT_LIMIT) {
        truncated = true;
        return;
      }
      output += chunk.toString("utf8").slice(0, OUTPUT_LIMIT - output.length);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timer = setTimeout(() => child.kill("SIGTERM"), ACTION_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const suffix = truncated ? "\n[output truncated]\n" : "";
      const result = redactActionOutput(`${output.trim()}${suffix}`.trim(), env);
      if (code === 0) {
        resolveRun({ output: result });
      } else {
        reject(
          new Error(
            `${result || "Action failed without output."}\n(exit ${code ?? "?"}${signal ? `, ${signal}` : ""})`,
          ),
        );
      }
    });

    child.stdin.end(input);
  });
}

export function createActionRunner(env: NodeJS.ProcessEnv) {
  const taskRunner = resolve(workspace, "live/taskmarket-live.sh");
  const workerCli = resolve(workspace, "scripts/taskmarket-worker.mjs");
  const tsx = resolve(workspace, "node_modules/.bin/tsx");

  return async (action: DashboardAction, typedConfirmation: string): Promise<ActionRunResult> => {
    const confirmationInput = `${typedConfirmation}\n`;

    switch (action.id) {
      case "submit":
        return runChild(
          taskRunner,
          ["submit"],
          { ...env, TASKMARKET_BIN: workerCli },
          confirmationInput,
        );

      case "accept":
        return runChild(taskRunner, ["accept"], { ...env, TASKMARKET_BIN: "" }, confirmationInput);

      case "deposit":
      case "resume-deposit": {
        if (!action.amount) throw new Error("Deposit action has no amount.");
        const status = await runChild(tsx, ["src/cli.ts", "status"], env);
        const args = ["src/cli.ts", "deposit", action.amount];
        if (action.id === "resume-deposit") args.push("--resume");
        const result = await runChild(tsx, args, env, confirmationInput);
        return { output: `${status.output}\n\n${result.output}`.trim() };
      }

      case "withdraw":
      case "resume-withdraw": {
        if (!action.amount) throw new Error("Withdrawal action has no amount.");
        const status = await runChild(tsx, ["src/cli.ts", "status"], env);
        const result = await runChild(
          tsx,
          ["src/cli.ts", "withdraw", action.amount],
          env,
          confirmationInput,
        );
        return { output: `${status.output}\n\n${result.output}`.trim() };
      }
    }
  };
}

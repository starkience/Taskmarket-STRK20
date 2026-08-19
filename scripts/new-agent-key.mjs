#!/usr/bin/env node
// Generates an EVM key and writes it into the gitignored live/.env.local.
//
// The key is never printed, echoed, or passed as an argument — only the derived
// address is shown, which is what you need in order to fund it or point at it. A
// key that holds funds should not pass through a terminal, a shell history, or a
// chat log.
//
// Usage: node scripts/new-agent-key.mjs <ENV_VAR_NAME>

import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV_FILE = new URL("../live/.env.local", import.meta.url).pathname;

const KNOWN = {
  AGENT_EVM_PRIVATE_KEY: {
    what: "the agent's funding EOA",
    why:
      "The Starknet key and viewing key are derived from a signature over this\n" +
      "key, so replacing it would orphan any pool notes and any funds on the\n" +
      "derived account.",
    next: "Fund it on Base with USDC and a little ETH for gas.",
  },
  WORKER_EVM_PRIVATE_KEY: {
    what: "the isolated TaskMarket worker EOA",
    why:
      "The worker's Starknet key and viewing key are derived from this key.\n" +
      "Replacing it would orphan its pool notes and any funds on its derived account.",
    next:
      "Import it into the isolated TaskMarket worker profile, then let it receive\n" +
      "the bounty before using the STRK20 bridge.",
  },
  AGENT_PAYOUT_PRIVATE_KEY: {
    what: "the agent's payout address (where withdrawals land)",
    why:
      "Withdrawals already sent to the old address would be stranded: the key is\n" +
      "the only way to spend them.",
    next:
      "Nothing to fund. This address only receives.\n" +
      "It is generated independently of the funding key on purpose — deriving it\n" +
      "would link the agent's public worker identity to where its earnings land.",
  },
};

const VAR = process.argv[2];
if (!VAR || !Object.hasOwn(KNOWN, VAR)) {
  console.error(`Usage: node scripts/new-agent-key.mjs <${Object.keys(KNOWN).join("|")}>`);
  process.exit(1);
}
const spec = KNOWN[VAR];

let contents;
try {
  contents = readFileSync(ENV_FILE, "utf8");
} catch {
  console.error(`Cannot read ${ENV_FILE}. Copy live/bridge.env.example to it first.`);
  process.exit(1);
}

let existing = new RegExp(`^${VAR}=(.*)$`, "m").exec(contents);
if (!existing && VAR === "WORKER_EVM_PRIVATE_KEY") {
  contents = `${contents.trimEnd()}\n\n# Isolated TaskMarket worker used by the live two-wallet demo.\n${VAR}=\n`;
  existing = new RegExp(`^${VAR}=(.*)$`, "m").exec(contents);
}
if (!existing) {
  console.error(`${ENV_FILE} has no ${VAR} line to fill in.`);
  process.exit(1);
}

// Overwriting an existing key is not recoverable.
if (existing[1].trim() !== "") {
  console.error(`${VAR} is already set.\n\nRefusing to overwrite it. ${spec.why}\n`);
  console.error("Move the old value somewhere safe and clear the line by hand if you");
  console.error("genuinely want a new one.");
  process.exit(1);
}

const privateKey = generatePrivateKey();
const { address } = privateKeyToAccount(privateKey);

writeFileSync(ENV_FILE, contents.replace(new RegExp(`^${VAR}=.*$`, "m"), `${VAR}=${privateKey}`), {
  mode: 0o600,
});
chmodSync(ENV_FILE, 0o600);

console.log(`Wrote a new key for ${spec.what} to live/.env.local (gitignored, mode 600).`);
console.log(`\n  ${address}\n`);
console.log(spec.next);
console.log("\nThe private key was not printed. It is only in that file.");

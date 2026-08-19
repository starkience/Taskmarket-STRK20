# Headless Privacy Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Ready Wallet API browser demo with a headless Node CLI agent that owns its own signer and runs the TaskMarket → CCTP → STRK20 → fresh-Base-address loop.

**Architecture:** A Node 20 ESM TypeScript CLI. Thin, tested glue modules (service-URL shim, confirmation gate, identity loader) sit under a command dispatcher; the money-moving orchestration is delegated wholesale to `@starkware-libs/starknet-privacy-bridge`. No browser, no bundle.

**Tech Stack:** Node 20+, TypeScript (strict, ESM), vitest, viem, tsx, `@starkware-libs/starknet-privacy-bridge@0.1.18`.

**Spec:** `docs/superpowers/specs/2026-08-13-headless-privacy-agent-design.md`

## Global Constraints

- Node 20 or newer. ESM only (`"type": "module"`).
- TypeScript `strict: true`. Existing style: double-quoted strings, 2-space indent, no semicolon omission.
- Tests are co-located `*.test.ts` under `src/`, run by vitest (`include: ["src/**/*.test.ts"]`, `exclude: ["vendor/**", ...]`).
- Secrets never appear in `process.argv`, log output, error messages, or any tracked file. The only persistent secret is the agent EVM private key, loaded from env.
- `live/.env.local` is gitignored and holds confidential StarkWare endpoints and AVNU credentials. Never commit it, never echo its values.
- No operation uses a full balance. Every money-moving command requires an exact typed confirmation.
- `vendor/` is gitignored and is a read-only reference. Never edit it.

## Blocked Work

**Tasks 6 and beyond cannot start yet.** `npm view @starkware-libs/starknet-privacy-bridge` returns `403 permission_denied: token does not match expected scopes`, so the dependency cannot be installed. Unblock with:

```bash
gh auth refresh -s read:packages
npm config set "//npm.pkg.github.com/:_authToken" "$(gh auth token)"
```

Spec blockers 1 (rc.3 vs rc.4 SDK revision), 3 (OZ account class hash), 4 (proof validity window), 5 (OHTTP), and 7 (pool fee) gate the first *mainnet run*, not the code in Tasks 1–5.

Tasks 1–5 are fully unblocked and produce a working, tested CLI skeleton.

---

### Task 1: Retire the browser app, repackage as a Node CLI

**Files:**
- Delete: `index.html`, `vite.config.ts`, `tsconfig.app.json`, `tsconfig.node.json`, `scripts/check-bundle.mjs`, `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/vite-env.d.ts`, `src/config.ts`, `src/hooks/usePrivacyWallet.ts`, `src/lib/cctp.ts`, `src/lib/cctp.test.ts`, `src/lib/strk20.ts`, `src/lib/strk20.test.ts`, `src/lib/starknet.ts`, `src/lib/walletStore.ts`
- Modify: `package.json`, `tsconfig.json`
- Keep: `src/lib/amounts.ts`, `src/lib/amounts.test.ts`, `vitest.config.ts`, `live/`

**Interfaces:**
- Consumes: nothing.
- Produces: an `npm test` and `npm run typecheck` that pass on a Node-only tree; `npx tsx src/cli.ts` as the entry point later tasks extend.

- [ ] **Step 1: Delete the browser-only files**

```bash
git rm -q --cached --ignore-unmatch index.html vite.config.ts tsconfig.app.json tsconfig.node.json 2>/dev/null || true
rm -f index.html vite.config.ts tsconfig.app.json tsconfig.node.json scripts/check-bundle.mjs
rm -f src/App.tsx src/main.tsx src/styles.css src/vite-env.d.ts src/config.ts
rm -rf src/hooks
rm -f src/lib/cctp.ts src/lib/cctp.test.ts src/lib/strk20.ts src/lib/strk20.test.ts
rm -f src/lib/starknet.ts src/lib/walletStore.ts
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 2: Replace `package.json`**

```json
{
  "name": "taskmarket-strk20-agent",
  "version": "0.3.0",
  "private": true,
  "type": "module",
  "description": "Headless agent moving a TaskMarket USDC bounty through the STRK20 privacy pool.",
  "scripts": {
    "agent": "tsx src/cli.ts",
    "typecheck": "tsc -b",
    "test": "vitest run",
    "check": "npm run typecheck && npm run test",
    "taskmarket": "taskmarket"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "starknet": "10.4.0",
    "viem": "^2.21.0"
  },
  "devDependencies": {
    "@lucid-agents/taskmarket": "1.10.0",
    "@types/node": "^24.13.2",
    "tsx": "^4.19.2",
    "typescript": "~6.0.2",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 3: Replace `tsconfig.json`**

`tsconfig.json` was a solution-style file referencing the two deleted app/node configs. It becomes a single Node config.

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "skipLibCheck": true,
    "noEmit": true,
    "strict": true,
    "noUncheckedIndexedAccess": true
  },
  "include": ["src", "vitest.config.ts"]
}
```

- [ ] **Step 4: Reinstall and verify the tree is clean**

```bash
rm -rf node_modules package-lock.json
npm install
npm run check
```

Expected: `tsc -b` emits nothing; vitest reports the 3 `amounts` tests passing. If vitest reports "No test files found", the deletion in Step 1 went too far — restore `src/lib/amounts.test.ts` from git.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: retire the browser app, repackage as a Node CLI

The Wallet API path is replaced by a headless agent. bridge-core owns the
Base to Starknet CCTP leg, so the local cctp implementation is redundant
rather than merely unused. The bundle secret check retires with the bundle
it guarded."
```

---

### Task 2: Service URL shim

`bridge-core` hardcodes `rpcUrl: "/rpc"`, `proverUrl: "/prover"`, `indexerUrl: "/indexer"` with no env override, and Node's `fetch` rejects relative URLs. This module rewrites those three prefixes to absolute upstreams and passes everything else through.

**Files:**
- Create: `src/serviceFetch.ts`
- Test: `src/serviceFetch.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ServiceUpstreams { rpc: string; prover: string; indexer: string }`
  - `resolveServiceUrl(input: string, upstreams: ServiceUpstreams): string | null` — absolute URL for a service path, `null` for anything else.
  - `readUpstreams(env: Record<string, string | undefined>): ServiceUpstreams` — throws if any of the three is missing or blank.
  - `installServiceFetch(upstreams: ServiceUpstreams): () => void` — patches `globalThis.fetch`, returns an uninstall function.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { installServiceFetch, readUpstreams, resolveServiceUrl } from "./serviceFetch";

const upstreams = {
  rpc: "https://rpc.example/v0_10",
  prover: "https://prover.example/",
  indexer: "https://indexer.example/",
};

describe("resolveServiceUrl", () => {
  it("maps each service prefix to its upstream", () => {
    expect(resolveServiceUrl("/rpc", upstreams)).toBe("https://rpc.example/v0_10");
    expect(resolveServiceUrl("/prover", upstreams)).toBe("https://prover.example");
    expect(resolveServiceUrl("/indexer", upstreams)).toBe("https://indexer.example");
  });

  it("preserves the remaining path and query", () => {
    expect(resolveServiceUrl("/indexer/notes?from=7", upstreams)).toBe(
      "https://indexer.example/notes?from=7",
    );
    expect(resolveServiceUrl("/rpc/mainnet", upstreams)).toBe("https://rpc.example/v0_10/mainnet");
  });

  it("returns null for anything that is not a service path", () => {
    expect(resolveServiceUrl("https://iris-api.circle.com/v2/messages", upstreams)).toBeNull();
    expect(resolveServiceUrl("/rpcelicious", upstreams)).toBeNull();
    expect(resolveServiceUrl("/other", upstreams)).toBeNull();
  });
});

describe("readUpstreams", () => {
  it("reads the three service URLs from env", () => {
    expect(
      readUpstreams({
        STARKNET_RPC_URL: "https://rpc.example",
        PROVER_URL: "https://prover.example",
        INDEXER_URL: "https://indexer.example",
      }),
    ).toEqual({
      rpc: "https://rpc.example",
      prover: "https://prover.example",
      indexer: "https://indexer.example",
    });
  });

  it("fails loudly when one is missing or blank", () => {
    expect(() =>
      readUpstreams({ STARKNET_RPC_URL: "https://rpc.example", PROVER_URL: "  " }),
    ).toThrow(/PROVER_URL/);
    expect(() => readUpstreams({})).toThrow(/STARKNET_RPC_URL/);
  });
});

describe("installServiceFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rewrites service paths and passes other requests through", async () => {
    const seen: string[] = [];
    const inner = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response("{}");
    });
    vi.stubGlobal("fetch", inner);

    const uninstall = installServiceFetch(upstreams);
    await fetch("/prover");
    await fetch("https://iris-api.circle.com/v2/messages");
    uninstall();

    expect(seen).toEqual([
      "https://prover.example",
      "https://iris-api.circle.com/v2/messages",
    ]);
  });

  it("restores the original fetch on uninstall", () => {
    const inner = vi.fn();
    vi.stubGlobal("fetch", inner);
    const uninstall = installServiceFetch(upstreams);
    expect(globalThis.fetch).not.toBe(inner);
    uninstall();
    expect(globalThis.fetch).toBe(inner);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/serviceFetch.test.ts`
Expected: FAIL — cannot resolve `./serviceFetch`.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ServiceUpstreams {
  rpc: string;
  prover: string;
  indexer: string;
}

const PREFIXES: ReadonlyArray<readonly [string, keyof ServiceUpstreams]> = [
  ["/rpc", "rpc"],
  ["/prover", "prover"],
  ["/indexer", "indexer"],
];

const ENV_KEYS: ReadonlyArray<readonly [string, keyof ServiceUpstreams]> = [
  ["STARKNET_RPC_URL", "rpc"],
  ["PROVER_URL", "prover"],
  ["INDEXER_URL", "indexer"],
];

export function readUpstreams(env: Record<string, string | undefined>): ServiceUpstreams {
  const out = {} as ServiceUpstreams;
  for (const [key, field] of ENV_KEYS) {
    const value = env[key]?.trim();
    if (!value) {
      throw new Error(`${key} is not set. bridge-core cannot reach its ${field} service.`);
    }
    out[field] = value;
  }
  return out;
}

// bridge-core builds same-origin paths ("/prover", "/rpc/mainnet"). Node's fetch
// rejects relative URLs, so map the three known prefixes onto absolute upstreams
// and leave every other request alone.
export function resolveServiceUrl(input: string, upstreams: ServiceUpstreams): string | null {
  for (const [prefix, field] of PREFIXES) {
    if (input !== prefix && !input.startsWith(`${prefix}/`) && !input.startsWith(`${prefix}?`)) {
      continue;
    }
    const base = upstreams[field].replace(/\/+$/, "");
    return `${base}${input.slice(prefix.length)}`;
  }
  return null;
}

export function installServiceFetch(upstreams: ServiceUpstreams): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") {
      const mapped = resolveServiceUrl(input, upstreams);
      if (mapped) return original(mapped, init);
    }
    return original(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/serviceFetch.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/serviceFetch.ts src/serviceFetch.test.ts
git commit -m "feat: map bridge-core's relative service paths onto absolute upstreams"
```

---

### Task 3: Confirmation gate

**Files:**
- Create: `src/confirm.ts`
- Test: `src/confirm.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ConfirmRequest { action: string; wallet: string; amount: string; network: string }`
  - `formatConfirmation(request: ConfirmRequest): string` — the operator-facing block.
  - `expectedPhrase(request: ConfirmRequest): string` — returns `` `${action} ${amount}` ``.
  - `confirmOrThrow(request: ConfirmRequest, answer: string): void` — throws unless `answer.trim()` equals the expected phrase exactly.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { confirmOrThrow, expectedPhrase, formatConfirmation } from "./confirm";

const request = {
  action: "deposit",
  wallet: "0x1111111111111111111111111111111111111111",
  amount: "1.000000 USDC",
  network: "Base mainnet (8453)",
};

describe("confirmation gate", () => {
  it("shows wallet, amount and network to the operator", () => {
    const text = formatConfirmation(request);
    expect(text).toContain("0x1111111111111111111111111111111111111111");
    expect(text).toContain("1.000000 USDC");
    expect(text).toContain("Base mainnet (8453)");
  });

  it("requires the exact phrase", () => {
    expect(expectedPhrase(request)).toBe("deposit 1.000000 USDC");
    expect(() => confirmOrThrow(request, "deposit 1.000000 USDC")).not.toThrow();
    expect(() => confirmOrThrow(request, "  deposit 1.000000 USDC  ")).not.toThrow();
  });

  it("aborts on a wrong, partial, empty or differently-cased answer", () => {
    expect(() => confirmOrThrow(request, "yes")).toThrow(/aborted/i);
    expect(() => confirmOrThrow(request, "deposit")).toThrow(/aborted/i);
    expect(() => confirmOrThrow(request, "")).toThrow(/aborted/i);
    expect(() => confirmOrThrow(request, "DEPOSIT 1.000000 USDC")).toThrow(/aborted/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/confirm.test.ts`
Expected: FAIL — cannot resolve `./confirm`.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ConfirmRequest {
  action: string;
  wallet: string;
  amount: string;
  network: string;
}

export function expectedPhrase(request: ConfirmRequest): string {
  return `${request.action} ${request.amount}`;
}

export function formatConfirmation(request: ConfirmRequest): string {
  return [
    "",
    "  This moves real mainnet funds.",
    `  action:  ${request.action}`,
    `  wallet:  ${request.wallet}`,
    `  amount:  ${request.amount}`,
    `  network: ${request.network}`,
    "",
    `  Type exactly: ${expectedPhrase(request)}`,
    "",
  ].join("\n");
}

export function confirmOrThrow(request: ConfirmRequest, answer: string): void {
  if (answer.trim() !== expectedPhrase(request)) {
    throw new Error("Aborted: confirmation phrase did not match.");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/confirm.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/confirm.ts src/confirm.test.ts
git commit -m "feat: add the typed confirmation gate for money-moving commands"
```

---

### Task 4: Agent identity

Loads the agent EVM key from env and produces the derivation signature `moveIntoPool` consumes. The key must never reach argv, logs, or an error message — the tests assert that directly.

**Files:**
- Create: `src/identity.ts`
- Test: `src/identity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `IDENTITY_MESSAGE: string` — the fixed message signed to derive pool key material.
  - `loadAgentAccount(env: Record<string, string | undefined>): PrivateKeyAccount` — reads `AGENT_EVM_PRIVATE_KEY`, validates shape, returns a viem account.
  - `deriveSignature(account: PrivateKeyAccount): Promise<`0x${string}`>` — signs `IDENTITY_MESSAGE`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { IDENTITY_MESSAGE, deriveSignature, loadAgentAccount } from "./identity";

// Well-known test key. Never used for funds.
const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("agent identity", () => {
  it("loads an account from the env key", () => {
    const account = loadAgentAccount({ AGENT_EVM_PRIVATE_KEY: KEY });
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("produces a stable signature over the identity message", async () => {
    const account = loadAgentAccount({ AGENT_EVM_PRIVATE_KEY: KEY });
    const first = await deriveSignature(account);
    const second = await deriveSignature(account);
    expect(first).toBe(second);
    expect(first).toMatch(/^0x[0-9a-f]{130}$/);
    expect(IDENTITY_MESSAGE.length).toBeGreaterThan(0);
  });

  it("rejects a missing or malformed key", () => {
    expect(() => loadAgentAccount({})).toThrow(/AGENT_EVM_PRIVATE_KEY/);
    expect(() => loadAgentAccount({ AGENT_EVM_PRIVATE_KEY: "not-a-key" })).toThrow(/64 hex/);
    expect(() => loadAgentAccount({ AGENT_EVM_PRIVATE_KEY: KEY.slice(0, 20) })).toThrow(/64 hex/);
  });

  it("never puts key material in the error message", () => {
    const bad = `0x${"a".repeat(63)}`;
    try {
      loadAgentAccount({ AGENT_EVM_PRIVATE_KEY: bad });
      throw new Error("should have thrown");
    } catch (error) {
      expect(String(error)).not.toContain("aaaa");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/identity.test.ts`
Expected: FAIL — cannot resolve `./identity`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";

// Signed once per run to derive the Starknet key and viewing key in memory.
// Changing this string changes the pool identity, so it is frozen.
export const IDENTITY_MESSAGE = "taskmarket-strk20-agent:v1:pool-identity";

export function loadAgentAccount(env: Record<string, string | undefined>): PrivateKeyAccount {
  const raw = env.AGENT_EVM_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error("AGENT_EVM_PRIVATE_KEY is not set.");
  }
  // Validate shape without ever interpolating the value into the message.
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("AGENT_EVM_PRIVATE_KEY must be 0x followed by 64 hex characters.");
  }
  return privateKeyToAccount(raw as `0x${string}`);
}

export function deriveSignature(account: PrivateKeyAccount): Promise<`0x${string}`> {
  return account.signMessage({ message: IDENTITY_MESSAGE });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/identity.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/identity.ts src/identity.test.ts
git commit -m "feat: load the agent EVM key from env and derive the identity signature"
```

---

### Task 5: CLI dispatcher

**Files:**
- Create: `src/cli.ts`, `src/commands/registry.ts`
- Test: `src/commands/registry.test.ts`

**Interfaces:**
- Consumes: `loadAgentAccount` (Task 4), `readUpstreams` + `installServiceFetch` (Task 2).
- Produces:
  - `type CommandName = "preflight" | "identity" | "deposit" | "balance" | "transfer" | "withdraw" | "status"`
  - `COMMANDS: readonly CommandName[]`
  - `parseCommand(argv: readonly string[]): { command: CommandName; args: readonly string[] }` — throws on an unknown or missing command.
  - `usage(): string`

Only `preflight` and `identity` are wired to real behaviour in this task. The other five throw a "not yet implemented — blocked on bridge-core" error, so the CLI's shape is testable before the dependency lands.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { COMMANDS, parseCommand, usage } from "./registry";

describe("command parsing", () => {
  it("accepts every advertised command", () => {
    for (const name of COMMANDS) {
      expect(parseCommand([name]).command).toBe(name);
    }
  });

  it("passes trailing arguments through", () => {
    expect(parseCommand(["deposit", "1.5"])).toEqual({ command: "deposit", args: ["1.5"] });
  });

  it("rejects an unknown or missing command", () => {
    expect(() => parseCommand([])).toThrow(/usage/i);
    expect(() => parseCommand(["frobnicate"])).toThrow(/unknown command/i);
  });

  it("lists every command in the usage text", () => {
    for (const name of COMMANDS) {
      expect(usage()).toContain(name);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/registry.test.ts`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 3: Write minimal implementation**

`src/commands/registry.ts`:

```ts
export const COMMANDS = [
  "preflight",
  "identity",
  "deposit",
  "balance",
  "transfer",
  "withdraw",
  "status",
] as const;

export type CommandName = (typeof COMMANDS)[number];

export function usage(): string {
  return `usage: npm run agent -- <command>\n\ncommands:\n${COMMANDS.map((c) => `  ${c}`).join("\n")}\n`;
}

export function parseCommand(argv: readonly string[]): {
  command: CommandName;
  args: readonly string[];
} {
  const [first, ...args] = argv;
  if (!first) {
    throw new Error(usage());
  }
  if (!(COMMANDS as readonly string[]).includes(first)) {
    throw new Error(`Unknown command: ${first}\n\n${usage()}`);
  }
  return { command: first as CommandName, args };
}
```

`src/cli.ts`:

```ts
import { installServiceFetch, readUpstreams } from "./serviceFetch";
import { loadAgentAccount } from "./identity";
import { parseCommand } from "./commands/registry";

const BLOCKED = "Not yet implemented: blocked on @starkware-libs/starknet-privacy-bridge.";

async function main(): Promise<void> {
  const { command } = parseCommand(process.argv.slice(2));

  if (command === "preflight") {
    const upstreams = readUpstreams(process.env);
    installServiceFetch(upstreams);
    const account = loadAgentAccount(process.env);
    // Hostnames are confidential; report reachability, not the URL.
    for (const name of ["rpc", "prover", "indexer"] as const) {
      const response = await fetch(`/${name}`, { method: "GET" }).catch(() => null);
      console.log(`  ${name}: ${response ? `reachable (${response.status})` : "unreachable"}`);
    }
    console.log(`  agent EOA: ${account.address}`);
    return;
  }

  if (command === "identity") {
    console.log(loadAgentAccount(process.env).address);
    return;
  }

  throw new Error(BLOCKED);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/commands/registry.test.ts && npm run check`
Expected: PASS, 4 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/commands/registry.ts src/commands/registry.test.ts
git commit -m "feat: add the agent CLI dispatcher with preflight and identity"
```

---

### Task 6 (BLOCKED): Bridge config initialisation

**Do not start until `npm view @starkware-libs/starknet-privacy-bridge` succeeds.**

**Files:**
- Create: `src/initBridge.ts`
- Modify: `package.json` (add the dependency), `src/cli.ts`
- Test: `src/initBridge.test.ts`

**Interfaces:**
- Consumes: `readUpstreams`, `installServiceFetch` (Task 2).
- Produces: `initAgentBridge(env: Record<string, string | undefined>): void` — installs the fetch shim, then calls `initBridgeConfig(bridgeEnvFromRecord(env, ""))`. Must run before any other bridge-core import that touches config.

Required env, all from `live/.env.local`: `STARKNET_RPC_URL`, `PROVER_URL`, `INDEXER_URL`, `OZ_ACCOUNT_CLASS_HASH_MAINNET`, `PROOF_VALIDITY_BLOCKS`, `AVNU_PAYMASTER_API_KEY`, `AGENT_EVM_PRIVATE_KEY`.

The test asserts ordering: the fetch shim is installed before `initBridgeConfig` runs, and `initAgentBridge` throws when `OZ_ACCOUNT_CLASS_HASH_MAINNET` is unset (bridge-core fails loud on it, and spec blocker 3 means we do not have the value yet).

Detailed steps are deliberately not written: the exact import surface must be read from the installed package rather than guessed from `vendor/`, whose version may differ from the published `0.1.18`.

---

### Tasks 7+ (BLOCKED): deposit, balance, transfer, withdraw, status

Blocked on Task 6, and on spec blockers 1, 3, 4 and 7 before any mainnet run. Each wraps one bridge-core orchestrator behind the Task 3 confirmation gate:

| Command | bridge-core call | Notes |
|---|---|---|
| `deposit` | `moveIntoPool({ signature, amountWei, sourceChainId: 8453 })` | Resume-safe; never re-burn |
| `balance` | `balance` / `discover` via viewing key | Read-only, no confirmation |
| `transfer` | `sendPrivateToStarknet` | Value stays in the pool |
| `withdraw` | `bridgeOut({ destChainId: 8453, resolveDepositWallet })` | Callback returns the fresh Base address |
| `status` | `bridgeTransferStatus` | Read-only, no confirmation |

---

## Execution notes

After Task 5, the tree is a working, tested Node CLI with two live commands and five that fail with a clear blocked message. `npm run check` is green. That is a legitimate stopping point if the GitHub Packages access is not resolved.

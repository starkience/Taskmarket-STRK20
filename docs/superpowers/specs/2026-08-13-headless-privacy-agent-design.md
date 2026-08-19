# Headless privacy agent: TaskMarket × STRK20

Date: 2026-08-13
Status: implemented. All seven commands are wired; no mainnet transaction has
been run. Sections below are corrected in place where implementation contradicted
the original design.

## Objective

Replace the human-operated Ready Wallet API browser demo with a headless Node
agent that owns its own signer and viewing key, and runs the full CLAUDE.md
flow on mainnet:

Base USDC bounty → agent EOA → CCTP → STRK20 privacy pool → private hold →
withdraw → CCTP → fresh Base recipient.

This remains a mainnet demo, not a production launch. It is unaudited.

## Decisions

Four decisions were taken during brainstorming. Each is recorded with the
alternative that was rejected, so a later reader can tell a choice from an
accident.

### D1 — Build on `bridge-core`, not the raw SDK

`vendor/privacy-bridge/packages/bridge-core`
(`@starkware-libs/starknet-privacy-bridge`) is a framework-agnostic,
DOM-free engine that already implements the orchestration this demo needs:
`moveIntoPool`, `bridgeOut`, `withdrawToStarknet`, `sendPrivateToStarknet`,
CCTP bytes and fees, AVNU paymaster, account scan, and key derivation. It
wires the privacy SDK in exactly one place (`core/poolClient.ts`).

Rejected: calling `@starkware-libs/starknet-privacy-sdk` directly. It would
buy an agent-owned Starknet signer independent of the Base payout address, at
the cost of rewriting deposit, withdraw, and CCTP orchestration that
bridge-core has already solved and tested.

### D2 — Full loop, including the CCTP return leg

The demo runs CLAUDE.md steps 1–6 end to end, exiting to a fresh Base
address rather than stopping at the shield.

An earlier concern that the return path depended on undeployed contracts was
wrong: bridge-core bakes mainnet anonymizer addresses. The OutboundAnonymizer
is `0x009067f35d2cab3cb933f3d78793660402026f8fa31e041ca2cab4a8e9a49092`, and
the InboundAnonymizer is baked alongside it. Both are public on-chain
addresses.

The relayer `submitGaslessBatch` callback is required only by `returnToPool`,
the Polygon deposit-wallet return path used by the trading app. No relayer is
needed here.

**Corrected during implementation.** The outbound leg uses `cashOut`, not
`bridgeOut`. `bridgeOut` is the trading-app variant and demands `accountIndex`
and `accountNonce`, which feed a per-account commitment. `cashOut` (over
`bridgeOutToWallet`) has the same shape — withdraw to the Anonymizer plus one
`InvokeExternal` into `Anonymizer.privacy_invoke` — but sets `mint_recipient` to
the destination directly, needs no per-account EOA or deposit wallet, and emits
**no per-account commitment H**, since a cash-out has no return claim. It is both
the simpler signature and the smaller on-chain footprint.

### D3 — One EVM key

A single EVM key serves as both the TaskMarket worker EOA (receiving the
public bounty payout) and the signer whose signature derives the pool
identity. The derivation is off-chain and one-way, so sharing the key across
both roles does not link the pool identity on-chain.

Rejected: a two-key model with a public Base transfer between the payout EOA
and a separate agent EOA. It buys key-rotation hygiene, not privacy, and adds
another public edge.

The key is generated fresh for this demo. It is never the user's MetaMask key.

### D4 — build pinned tarballs from source

GitHub Packages returns `403 permission_denied` for both packages, so the
original plan (install `@starkware-libs/starknet-privacy-bridge@0.1.18`
straight from that registry) is not available.

Instead, `scripts/build-deps.sh` clones both public repos at pinned revisions,
builds them, and packs tarballs into the gitignored `vendor/tarballs/`.
`package.json` resolves both via `file:`. This needs no registry token at all.

Pins:

- SDK: tag `PRIVACY-0.14.3-RC.3`
- bridge-core: commit `0ba65f00fdee3af3419a7562c36b14fc2e92b8a7` (version 0.1.18)
- `starknet`: `10.0.0-beta.6` exactly, mirroring bridge-core's peer pin

The SDK needs no Scarb build: its generated ABIs and Cairo hashes are
committed, so `npm ci --ignore-scripts && npm run build` suffices.

Rejected: a git submodule (drags in the Scarb and turbo workspace) and copying
the modules into this repo (silent drift from a security-critical codebase).

Consequence: a fresh clone must run `scripts/build-deps.sh` before
`npm install`, because `vendor/` is gitignored. The script is the reproducible
record of exactly which revisions this demo was built against.

## Architecture

Node 20, ESM, TypeScript. No browser, no vite, no bundle.

### What is retired

`src/App.tsx`, `src/main.tsx`, `src/hooks/usePrivacyWallet.ts`,
`src/lib/strk20.ts`, `src/lib/cctp.ts`, `src/lib/starknet.ts`,
`src/lib/walletStore.ts`, `src/styles.css`, `index.html`, `vite.config.ts`,
the three `tsconfig.*.json` app variants, and `scripts/check-bundle.mjs`.

`src/lib/cctp.ts` is retired because `moveIntoPool` owns the Base→Starknet
CCTP burn itself, resume-safe, via `sourceChainId` and `onBurned`. Keeping a
second CCTP implementation would mean two things to audit and two things to
get wrong.

`scripts/check-bundle.mjs` retires with the browser bundle it guarded. There
is no bundle in a Node agent; secret hygiene moves to the rules in "Secret
hygiene" below.

### What survives

`live/taskmarket-live.sh`, `live/README.md`, `README.md`, `src/lib/amounts.ts`
and its tests, and `live/.env.local` (gitignored).

### Modules

Each module has one purpose and can be tested without the others.

| Module | Purpose | Depends on |
|---|---|---|
| `src/initBridge.ts` | Call `initBridgeConfig(bridgeEnvFromRecord(process.env, ''))` before any config-touching import. Install the fetch shim. | bridge-core config |
| `src/serviceFetch.ts` | Rewrite relative `/rpc`, `/prover`, `/indexer` to absolute upstreams. | env only |
| `src/identity.ts` | Load the encrypted EVM key, produce the derivation signature. Never returns raw key material to callers. | viem |
| `src/confirm.ts` | Print wallet, amount, network; require an exact typed confirmation. | none |
| `src/commands/*.ts` | One file per CLI command; thin glue over bridge-core. | all of the above |
| `src/cli.ts` | Argument parsing and dispatch. | commands |

### Config injection

bridge-core reads no build-tool env. The consuming app reads its own env at
startup and injects it. `src/initBridge.ts` calls
`initBridgeConfig(bridgeEnvFromRecord(process.env, ''))` as its first
statement, before any other bridge-core import that touches config. This
mirrors the pattern the bridge's own apps use, and a Semgrep rule in the
upstream repo exists precisely because reaching around it breaks.

### The relative-URL problem

`bridge-core` hardcodes `rpcUrl: '/rpc'`, `proverUrl: '/prover'`,
`indexerUrl: '/indexer'`, with no env override. The upstream comment reads
"Dev-only same-origin proxied paths (production uses OHTTP, one
gateway/network)." Browser apps satisfy these with a dev proxy. Node's
`fetch` rejects relative URLs outright.

`src/serviceFetch.ts` installs a `globalThis.fetch` wrapper at startup that
rewrites those three prefixes to absolute upstreams read from the
environment, and passes every other request through untouched.

**Corrected during implementation: the shim alone is not sufficient.**
`starknet.js` validates `nodeUrl` at construction and falls back to its own
public node *before* `fetch` is ever reached, so a relative `/rpc` meant every
Starknet read came from a node nobody configured — silently, with no error.
`initAgentBridge` therefore also overwrites `config.rpcUrl`, `config.proverUrl`
and `config.indexerUrl` with the real upstreams after init (the config object is
mutable; verified). The shim stays as a backstop for anything that builds its own
path.

Trailing slashes are stripped in `readUpstreams`: the SDK joins as
`${base}/v1/...`, so a configured `https://host/` produced a double slash, which
the discovery service answers 404 rather than 405.

`BASE_RPC_URL` is required for the same class of reason: viem and bridge-core
both fall back to the shared public `mainnet.base.org` when it is unset.

## Key model and secret hygiene

The only persistent secret is the EVM private key.

- Generated fresh for this demo; low value; never the user's MetaMask key.
- Stored encrypted at rest, outside the repository.
- Loaded from an environment variable at runtime. Never a command-line
  argument (argv is world-readable via `ps`), never written to a log.
- `moveIntoPool` derives the Starknet private key and the viewing key from
  the wallet signature, in memory, on each run. Neither is persisted.

The service endpoints in `live/.env.local` are confidential and gitignored.
They are not reproduced in this document, and they must not be committed,
logged, or pasted into an issue.

`npm run new-key` generates the key and writes it straight into that file at
mode 600, printing only the derived address. The key is never echoed, so it does
not enter a terminal, a shell history, or a chat log. It refuses to overwrite an
existing value: the Starknet key and viewing key derive from a signature over it,
so replacing it orphans any pool notes and any funds on the derived account.

## Cursor persistence

bridge-core stores its in-flight CCTP burn cursors in `localStorage`, wrapping
every read and write in a `try/catch` that swallows failures. Node has no
`localStorage`, so outside a browser those reads return empty, every burn looks
fresh, and a retried deposit burns real USDC a second time — the double-spend
bridge-core's own comments warn about, silently re-opened by running headlessly.

`src/storage.ts` is a file-backed Web Storage shim installed by
`initAgentBridge` before anything can touch a cursor, writing through to disk on
every `set` because a cursor held only in memory is lost in the crash it exists
to survive. Anyone else running bridge-core outside a browser needs an
equivalent; the failure mode is silent and costs money.

## Data flow

1. `live/taskmarket-live.sh create|submit|accept` — bounty funded and settled
   in USDC on Base. Net payout lands on the agent EOA.
2. `deposit` — `moveIntoPool({signature, amountWei, sourceChainId: 8453})`.
   Deploys and registers the derived Starknet account if needed, burns via
   CCTP on Base, mints on Starknet, deposits into the pool. Resume-safe.
3. `balance` — private balance via the viewing key.
4. `transfer` (optional) — `sendPrivateToStarknet`; value never leaves the
   pool.
5. `withdraw` — `bridgeOut({destChainId: 8453, resolveDepositWallet})`, where
   the injected callback returns the fresh Base recipient. Without the
   callback, bridgeOut would mint to a CREATE2 deposit wallet, which is a
   construct of the trading app and not what this demo wants.

## Account deploy funding

The Starknet account derived from the wallet signature does not exist
on-chain until it is deployed, and `moveIntoPool` deploys it on first use.
That deploy has to be paid for. bridge-core offers two paths, selected by
whether `AVNU_PAYMASTER_API_KEY` is set:

- **Paymaster set** — AVNU's relayer is the caller and sponsors gas. Upstream
  marks this the production path. Under `default` deploy-fee mode the
  one-time deploy fee is paid in USDC from the account itself, which means
  the account must hold USDC *before* the deploy; `moveIntoPool` enforces the
  fund-then-deploy ordering.
- **Paymaster unset** — an admin-funded path that upstream marks
  testnet/dev-only. Not viable for this demo.

We therefore enable the AVNU paymaster. The credentials were supplied
privately and belong in `live/.env.local` with the service endpoints: never
committed, never logged, never passed as a command-line argument.

The upstream warning that "anyone who inspects the bundle can extract it"
applies to browser builds. A Node agent has no bundle, so the key stays
server-side by construction — which is one more reason the browser app is
retired rather than extended.

Open question for the mainnet run: whether the paymaster sponsors the pool
fee as well as gas, or only gas. This interacts with blocker 7 (pool fee
unknown) and should be settled before the first deposit.

## Error handling

- Every money-moving command requires an exact typed confirmation naming the
  wallet, amount, and network.
- No operation uses a full balance. Reserves are left for retries and fees.
- A TaskMarket write reporting `pending: true` halts the run. It is never
  retried with a fresh idempotency key; the original task is re-fetched until
  the effect appears.
- CCTP burns are resumed, never re-issued. `moveIntoPool` persists in-flight
  burn state and short-circuits on resume; `resume: true` is the
  never-start-a-burn signal.
- A failed proof or expired proof window rebuilds the proof rather than
  re-sending value.

## Testing

Vitest, co-located `*.test.ts`, as today.

Covered:

- `serviceFetch` — each of the three prefixes maps to the right upstream;
  every other URL passes through unmodified; an unset upstream fails loudly
  rather than silently 404ing.
- `initBridge` — config init happens before any config read.
- `amounts` — existing coverage retained.
- `confirm` — a wrong or empty confirmation string aborts.

Not covered here: the bridge-core orchestrators. They are tested upstream;
duplicating them would test the dependency, not the glue.

The mainnet run is manual, confirmed at each step, and starts small.

## Blockers

### Resolved

Verified 2026-08-13 by building the contracts and querying mainnet directly,
rather than by trusting the env doc — which turned out to be wrong in three
places.

1. **SDK revision — resolved.** The class actually deployed at the pool
   address is
   `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`, not
   the `0x030b8c54…` the env doc lists. Both `PRIVACY-0.14.3-RC.3` and
   `PRIVACY-0.14.3-RC.4`, built with scarb 2.17.0 under `--profile release`,
   compile to exactly that hash — they differ only by a blank line in
   `snip12.cairo`. The built ABI matches the deployed one (45 functions) and
   the Sierra programs are the same length. So bridge-core's `0.14.3-rc.3`
   pin is byte-exact against the live pool; no upgrade is needed.

   `PRIVACY-0.14.3-RC.5` (tagged 2026-08-12) reworks signature validation in
   `utils.cairo` and does **not** match the deployed class. Do not adopt it
   without re-checking.

2. **Registry access — resolved by not needing it.** See D4:
   `scripts/build-deps.sh` builds both packages from public source.

3. **Proof validity window — resolved.** `get_proof_validity_blocks()`
   returns `450`, confirming the env doc. `live/.env.local` sets 400,
   deliberately leaving margin for submission latency.

4. **Pool fee — resolved.** `get_fee_amount()` returns `6000000000000000000`
   and `get_fee_collector()` returns
   `0x0d79041634625e5288296fbc648088788710ba44903a3a49468a66567749e77`. The
   fee is denominated in the fee token (STRK), not USDC — 6 STRK per action.
   bridge-core already handles this: it exports `fetchPoolFeeStrk`,
   `readPoolFeeAmount`, `approvePoolFee`, `strkFeeToUsdc` and `getStrkBalance`.

   The pool is live and healthy: `get_version()` is `2.0`, `is_paused()` is 0.

5. **OZ account class hash — resolved and confirmed.**
   `OZ_ACCOUNT_CLASS_HASH_MAINNET` is required by bridge-core, has no default,
   and fails loud when unset. StarkWare's env doc cannot supply it: its
   "Governance Admin (OZ account)" value is 64 hex digits, exceeding the
   felt252 maximum, so it is not a valid Starknet address and the chain
   rejects it with `felt overflow`. It is also mixed-case, unlike every other
   value in that document.

   Sourced instead from bridge-core's own test fixture
   (`packages/bridge-core/vitest.setup.ts`):
   `0x5b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564`.
   Verified independently: declared on mainnet, a genuine OpenZeppelin
   account (`AccountABI` with `__execute__`, `__validate__`,
   `__validate_declare__`, `is_valid_signature`), and carrying
   `ISRC9_V2` (outside execution) — which is what the AVNU
   paymaster-sponsored deploy path requires.

   StarkWare confirmed this on 2026-08-13: it is labelled OpenZeppelin in their
   class-hash breakdown of pool depositors and is declared and in use on
   mainnet.

   That answer carried a privacy caveat worth recording. Only **10 depositors
   (0.47%)** use this class. The depositing Starknet account is public, so its
   class hash is observable, and it places this agent in a small identifiable
   cohort — narrower than the pool's overall anonymity set. bridge-core derives
   its account address from this class, so it is not a free choice here, but it
   is a real public edge and belongs in the privacy boundary below.

6. **Pool fee funding — partly resolved; one case still open.** The pool's
   `apply_actions` calls `collect_fee()`, pulling the fee from the transaction
   caller in STRK. Under a paymaster `approvePoolFee` is a no-op and the fee is
   instead "baked into the proof as a withdraw to the AVNU forwarder" — i.e. a
   USDC withdraw **from the pool**. So no STRK balance is needed.
   `sponsored` must NOT be set: it forces the fee token to STRK, which a
   USDC-only account cannot pay.

   **Open:** a withdraw needs a note to withdraw from, and `register` runs
   before any note exists. StarkWare's own Polymarket integration records the
   fee as coming from "a pre-existing ≥0.5 USDC buffer note" that "cannot net
   against the returned funds", which suggests the first proven action on an
   empty identity may not be self-funding. Verify on a small first deposit
   before assuming it is. An earlier version of this document asserted the
   deposit always funds its own fee; that was too strong.

### Open

7. **OHTTP.** Production is documented as routing prover and discovery
   through an OHTTP gateway. Connecting directly means StarkWare's services
   observe the agent's IP address alongside its proof requests and note
   queries. The SDK depends on `ohttp-ts`, so the capability is present;
   whether a relay is expected for mainnet is unconfirmed.

8. **Starknet RPC.** StarkWare's Pathfinder (`:9545`) and Juno (`:6060`) hosts
   refuse connections from this machine; they appear to be allowlisted. The
   user's Alchemy mainnet RPC is used instead.


### Env doc corrections to report

The document is accurate almost everywhere — its Vesu lending helper
(`0x2fec7288…`) and Ekubo swap helper (`0x61047c20…`) class hashes both match
mainnet exactly. That makes the following look like genuine errors rather than
general staleness:

- **Privacy class hash is wrong**: deployed is `0x67dddd89…`, not
  `0x030b8c54…`. Nothing we built or found on-chain produces the doc's value.
- **Governance admin address is not a valid felt** — 64 hex digits, above the
  felt252 maximum, and mixed-case.
- **Fee and fee collector** are listed "TBD" but are readable on-chain:
  `6000000000000000000` and `0x0d790416…`.
- **Gateway URL says `alpha-sepolia`** in a mainnet document.
- **Tag is "TBD (rc.4)"** — the deployed class corresponds to
  `PRIVACY-0.14.3-RC.3`/`RC.4`, which are byte-identical once compiled.

## Privacy boundary

Unchanged from the current README, and worth restating because the agent
model does not improve it. TaskMarket activity, the Base payout, the CCTP
burn, the public Starknet mint, the pool deposit amount, and the timing of
all of these are public. Privacy begins inside the pool. Deposits and
withdrawals remain observable edges; amount and timing correlation still
applies. Direct (non-OHTTP) service access adds the agent's IP to what
StarkWare can observe.

**Never chain the legs.** Deposit and withdraw are separate commands, and that
is deliberate, not incidental: value must rest in the pool between them.
StarkWare's Polymarket integration keeps its two legs as separate user actions
for exactly this reason — an immediate deposit-then-withdraw of equal amounts
correlates regardless of what the proof hides. Do not script them together.

**The payout address must never be funded from anything linkable.** It receives
USDC and holds no gas. The moment it is topped up with ETH from the agent EOA,
or from the requester's wallet, both ends of the round trip are joined on Base
and the pool leg is wasted. StarkWare rates this class of leak — "a funder that
touches BOTH chains is an on-chain join key" — as their top privacy risk and a
hard blocker. If the payout address ever needs to spend, the gas must come from
a path that is not correlatable: a relayer or meta-transaction that submits on
its behalf, so it needs no inbound native transfer at all.

Two further edges are specific to this build:

- The depositing Starknet account's **class hash is public**, and only 10
  depositors (0.47%) use the OZ class bridge-core derives from. That is a much
  smaller cohort than the pool's overall anonymity set.
- The agent's Base EOA both receives the TaskMarket payout and funds the
  deposit (D3), so those two public edges are already joined by design.
- **Amounts.** A payout is fee-shaped by construction — a bounty netted of the
  platform fee, then the pool fee. Withdrawing that residue is a 1:1
  fingerprint across the whole chain. `withdraw` warns on distinctive amounts;
  fixed denominations, which is the real mitigation, are not implemented. No
  unlinkability claim here should depend on amount privacy.

This is an engineering demo, not an anonymity guarantee.

## Out of scope

- The Polygon trading paths (`fundAccountFromPool`, `returnToPool`) and the
  relayer they need.
- Any AVNU private-swap feature.
- Production hardening, audit, or key-management infrastructure beyond the
  encrypted-at-rest rule above.
- Retaining the Ready Wallet API path. The two key models are not mixed.

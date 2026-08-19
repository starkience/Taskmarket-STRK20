# Live Base bounty → agent → STRK20 runbook

This runbook creates a real TaskMarket bounty on Base, releases a real USDC
payout, bridges public USDC to Starknet through CCTP, and deposits it into the
STRK20 privacy pool — all driven by the headless agent.

Private keys belong only in the gitignored `live/.env.local`, created through
the guarded key scripts or an operator-controlled hidden import prompt. Never
paste a key into chat or pass one through a command flag.

## The task

The bounty asks for a short Markdown report that separates the public facts in
the TaskMarket-to-STRK20 flow from the one link the pool hides. Its acceptance
criteria are intentionally mechanical: exactly two sections, 6–10 bullets, no
more than 250 words, and no complete-anonymity claim. Full text in
[bounty.md](bounty.md).

- Reward: `BOUNTY_REWARD_USDC`, default 8 USDC — enough for the planned 5 USDC
  deposit after TaskMarket and privacy-route fees
- Deliverable: [demo-deliverable.md](demo-deliverable.md)

**What the privacy leg actually covers:** the report, its on-chain deliverable
hash, the worker address, the payout and both pool amounts are all public. The
single private fact is which later withdrawal corresponds to the worker's pool
deposit; amount and timing correlation can still weaken that boundary.

## Suggested first transaction

- 8.00 USDC TaskMarket bounty escrow
- 0.001 USDC TaskMarket acceptance action
- platform fee at the documented 7.5% rate
- the net payout, bridged via CCTP
- the pool fee, taken from the deposit in USDC
- Circle's live CCTP Fast protocol fee
- Base ETH for approval and burn
- the AVNU paymaster sponsors Starknet gas; bridge-core's non-paymaster deploy
  path is testnet-only upstream, so the paymaster credential is required

Do not bridge or shield the wallet's entire balance. Leave reserves for retries,
gas and fees.

## 1. Import the operator EOA into TaskMarket

Use a dedicated, low-value MetaMask EOA on Base. Import the same EOA through the
CLI's hidden prompt:

```bash
npm ci
./node_modules/.bin/taskmarket wallet import
```

Do not use `taskmarket init` for this run: its generated key is intentionally
contained by TaskMarket and cannot sign the browser CCTP transaction. Do not use
`--key` or `TASKMARKET_IMPORT_KEY`.

Review and accept TaskMarket's current legal bundle yourself:

```bash
./node_modules/.bin/taskmarket legal status
./node_modules/.bin/taskmarket legal accept
```

The pinned CLI currently has advisories in its optional XMTP dependency path.
This demo does not start `taskmarket daemon` or use XMTP.

## 2. Execute the bounty

Every money-moving CLI stage prints its wallet, amount and network, then requires
an exact typed confirmation:

```bash
live/taskmarket-live.sh preflight
live/taskmarket-live.sh create
live/taskmarket-live.sh submit
live/taskmarket-live.sh accept
live/taskmarket-live.sh status
```

The default bounty is 8 USDC. Public transaction metadata and CLI responses are
stored under `live/.state/`; the directory is gitignored and contains no key.

For a controlled two-wallet test, generate and import a separate worker without
replacing the requester keystore:

```bash
npm run new-worker-key
node scripts/import-taskmarket-worker.mjs
TASKMARKET_BIN="$PWD/scripts/taskmarket-worker.mjs" live/taskmarket-live.sh submit
```

The worker's raw key stays only in `live/.env.local`. Its encrypted TaskMarket
keystore stays under `live/.state/`. `scripts/taskmarket-worker.mjs` restores the
requester profile after every worker command.

If a write reports `pending: true`, stop. Do not retry it with a fresh
idempotency key. Re-fetch the original task until the effect appears.

## 3. Bridge and deposit with the agent

The Ready wallet is no longer involved. The agent holds its own low-value EVM
key and derives its Starknet key and viewing key from a signature over it.

Load the gitignored environment and check the services first:

```bash
set -a; . live/.env.local; set +a
npm run agent -- preflight
```

`preflight` reports reachability for the RPC, prover and discovery services and
prints the agent EOA. It moves no funds and prints no hostnames.

```bash
npm run agent -- deposit <amount>
npm run agent -- balance
npm run agent -- withdraw <amount>            # to the agent's payout address
npm run agent -- transfer <amount> <sn-address>
npm run agent -- status
```

Each money-moving command prints its wallet, amount and network, then requires
an exact typed confirmation naming the amount. A stale prompt from an earlier
run cannot be confirmed by muscle memory.

All are implemented and the complete mainnet route was verified on 2026-08-19.
The receipts under `live/.state/` are live-run state: inspect `status` before any
retry, and never replay a completed burn.

`npm run agent -- dashboard` serves ten live checkpoints on loopback. It exposes
only the next valid action—submit, accept, deposit/resume, or, in a later
dashboard session, withdraw/resume. Each button requires the same exact typed
confirmation as the CLI. The server re-reads state before running a fixed
command, allows only one at a time, and never sends a key to the browser.

The guarded dashboard does not weaken the operating rules: it runs `status`
before bridge actions, converts any in-flight transfer into a resume-only
button, and cannot expose withdrawal in the same server session that completed
the deposit. Funding and gas preparation remain deliberate external steps.

A CCTP burn is resumed, never re-issued. If a deposit is interrupted after the
burn, re-run it: `moveIntoPool` persists in-flight burn state and short-circuits
rather than burning again.

The current integration uses:

- Base native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Starknet native USDC `0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb`
- STRK20 mainnet pool `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
- Base CCTP domain `6`; Starknet CCTP domain `25`

## AVNU

The agent's Starknet account does not exist on-chain until it is deployed, and
that deploy costs gas. bridge-core's non-paymaster path is marked testnet-only
upstream, so the AVNU paymaster is required: its relayer is the caller and
sponsors gas.

The credential lives in `live/.env.local` as `AVNU_PAYMASTER_API_KEY`. That file
is gitignored. There is no browser bundle for it to leak into.

The pool fee needs no STRK. `apply_actions` calls `collect_fee()` against the
transaction caller, but under a paymaster `approvePoolFee` is a no-op and the fee
is baked into the proof as a USDC withdraw to the AVNU forwarder. Do not set
`sponsored`: that forces the fee token to STRK, which a USDC-only account cannot
pay. Base gas for the approve and burn is still paid by the agent in ETH.

**Unverified on a first deposit.** That withdraw needs a note to withdraw from,
and `register` runs before any note exists. StarkWare's Polymarket integration
describes the fee as coming from "a pre-existing 0.5 USDC buffer note" which
"cannot net against the returned funds" — so the first proven action on an empty
identity may not be self-funding. Watch for it on the first small deposit.

## Privacy statement

The bounty, worker EOA, payout, CCTP burn, agent Starknet address, public
Starknet mint, STRK20 deposit amount, and timing are observable. The resulting
note owner and later in-pool transfers are shielded. Separating bridge and
deposit does not erase timing or uniquely sized amount correlation. Reaching the
prover and discovery services directly, rather than through an OHTTP relay, also
exposes the agent's IP to those services.

This is an engineering demo, not an anonymity guarantee.

## Sources

- [TaskMarket bounty trace](https://docs.taskmarket.dev/examples/bounty-trace#bootstrap)
- [TaskMarket contracts](https://github.com/daydreamsai/taskmarket-contracts)
- [STRK20 Tip Jar](https://github.com/starkience/strk20-tipjar-example)
- [privacy-bridge](https://github.com/starkware-libs/privacy-bridge)

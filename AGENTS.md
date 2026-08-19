# AGENTS.md — handoff

Entry point for any agent working on this repo. Read this before touching code.
`CLAUDE.md` holds the original project brief; this file holds current state.

## What this is

A headless Node CLI that moves a TaskMarket USDC payout on Base through the
STRK20 privacy pool on Starknet and back out to a second Base address that
cannot be linked to the first. Plus a local operator dashboard that shows ten
checkpoints and exposes only the next valid action behind exact confirmation.

It is an unaudited mainnet demo, not a product.

## Run it

```bash
scripts/build-deps.sh          # only needed once; see D4 below
npm install
set -a; . live/.env.local; set +a
NETWORK=mainnet npm run agent -- status
NETWORK=mainnet npm run agent -- dashboard   # http://127.0.0.1:4173
npm run check                  # 84 tests + typecheck
```

`live/.env.local` is gitignored. A configured operator workspace contains both
Alchemy RPCs, the StarkWare prover/discovery endpoints, the AVNU paymaster key,
the OZ class hash, and the agent keys; a fresh clone must provide them locally.

## State

**Works and is verified on mainnet:** TaskMarket bounty creation, worker
submission and acceptance, Base → Starknet CCTP, STRK20 deposit, a deliberate
resting period, STRK20 withdrawal, and Starknet → fresh Base CCTP. Every read
path, safety guard, and guarded dashboard action is also verified. The browser
receives no private key.

## The three addresses

| role | address | notes |
|---|---|---|
| requester | `0xe5eAB2ecEE1943Ce31517DAbD1bDE0d7c467428e` | created and funded the demo bounty |
| worker EOA | `0xb21bE9b0273f61CaC2C308C5C085b4625E0B7880` | won the bounty and initiated the privacy route |
| payout | `0xD5927e0C0A1Ca1bE04D52790Ff875e8Aff518977` | fresh Base recipient; never fund it from a linkable wallet |
| Starknet | `0x23f278d61db68480f9d9c9c216f57c58c21343da8b877925a14a7a33864a925` | worker-derived pool identity; key not stored separately |

The Starknet key and viewing key are derived from an EVM signature per run and
never persisted. Only the two EVM keys exist on disk.

## Rules that are not negotiable

- **Never print, log, or pass a private key as an argument.** `npm run new-key`
  and `npm run new-payout-key` write to the gitignored env file and print only
  the address. They refuse to overwrite an existing key: doing so orphans pool
  notes and strands withdrawn funds.
- **Never fund the payout address from anything linkable** — not the agent EOA,
  not the requester's wallet. That single transfer joins both ends of the round
  trip on Base and destroys the property the pool provides.
- **Never chain `deposit` and `withdraw`.** They are separate commands so value
  rests in the pool between them. Scripting them together discards the privacy.
- **Every money-moving command keeps its typed confirmation.** Do not add a
  `--yes` flag.
- **Run `status` before re-running anything that appeared to fail.** An in-flight
  transfer must be resumed, never reissued.
- **The dashboard may expose only a fixed, state-derived next action.** It must
  re-read state on POST, allow only one action at a time, and pass the operator's
  exact phrase through the underlying CLI confirmation. No arbitrary commands.

## Traps already found (each cost hours; do not re-introduce)

1. **bridge-core stores CCTP burn cursors in `localStorage`** and swallows every
   failure in a `try/catch`. Node has no `localStorage`, so reads returned empty,
   every burn looked fresh, and a retry would burn real USDC twice.
   `src/storage.ts` is a file-backed shim installed by `initAgentBridge` before
   anything touches a cursor. It is fund-safety, not convenience.
2. **`starknet.js` validates `nodeUrl` at construction** and silently falls back
   to its own public node before `fetch` is reached. A relative `/rpc` therefore
   read from a node nobody configured. `initAgentBridge` overwrites
   `config.rpcUrl`/`proverUrl`/`indexerUrl` with absolute upstreams after init.
   The fetch shim alone is not sufficient.
3. **The SDK joins paths as `${base}/v1/...`**, so a configured URL with a
   trailing slash produced a double slash and a 404. `readUpstreams` strips them.
4. **`NETWORK` defaults to `testnet`** in bridge-core when unset, which would
   silently use the Sepolia pool. `initAgentBridge` refuses anything but an
   explicit `mainnet`.
5. **No animation may control visibility.** An entry animation once stranded the
   whole dashboard at `opacity: 0`. Reveals are CSS with `both` fill; Motion
   drives transforms only, every call guarded.
6. **bridge-core requires Starknet RPC 0.9's `pre_confirmed` block tag.** The
   configured Alchemy v0.8 endpoint was reachable but rejected those reads, so
   the standalone balance command failed and a deposit would have failed later.
   `readUpstreams`/`requireRpcUrl` normalize known versioned Alchemy v0.6-v0.8
   URLs to v0.9 in memory. Every bridge-backed command also proves the reported
   RPC version and a real read-only `pre_confirmed` call before continuing.
7. **Back-to-back Base transactions must reserve their nonce once.** A mined
   approval followed by a fresh nonce read hit a lagging Alchemy backend and the
   CCTP burn reused the approval nonce (`replacement transaction underpriced`).
   `makeEvmSender` now reads the pending nonce once and increments it locally
   across the ordered approval/burn group.
8. **Command errors may contain credentials and signed payloads.** viem includes
   the full RPC URL and `eth_sendRawTransaction` body in some errors. The
   dashboard runner redacts secret-bearing env values and long signed hex before
   returning output to the browser. Keep this guard on every action result.

## Version pinning (do not bump casually)

The deployed pool class is
`0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`. Both
`PRIVACY-0.14.3-RC.3` and `RC.4` compile to exactly that under scarb 2.17.0 with
`--profile release`; `RC.5` does not. bridge-core's `0.14.3-rc.3` pin is
therefore byte-exact against the live pool.

StarkWare's published env doc lists a different class hash. It matches nothing
on-chain. Trust the chain.

`scripts/build-deps.sh` builds both packages from public source because GitHub
Packages 403s. It is the reproducible record of what this was built against.

## Open items

1. **One payout address, reused.** Repeated runs aggregate and re-link. Real use
   needs a fresh payout address per withdrawal (indexed derivation).
2. **No spend path.** The payout address has no gas, so private earnings cannot
   be spent without deanonymising. Needs a relayer or paymaster.
3. **OHTTP unwired.** The prover sees the viewing key alongside the Starknet
   address. StarkWare's own integration has the same gap.
4. **Fixed denominations not implemented.** `withdraw` warns on fee-shaped
   amounts; that is a nudge, not a mitigation.

## What the privacy actually is

One fact is hidden: which pool withdrawal corresponds to which deposit, and
therefore that the payout address belongs to the same agent as the worker
address.

Everything else is public — the task, the deliverable and its on-chain hash, the
worker, the payout amount, both CCTP legs, and both pool amounts and timings. At
single-transaction scale, matching amounts minutes apart relink the two ends by
arithmetic regardless of the proof. The pool supplies the mechanism; other
depositors supply the anonymity.

Do not overstate this in docs, UI, or conversation.

## Further reading

- `docs/superpowers/specs/2026-08-13-headless-privacy-agent-design.md` — design,
  four recorded decisions, full blocker list
- `docs/superpowers/plans/2026-08-13-headless-privacy-agent.md` — implementation plan
- `live/README.md` — operator runbook
- `live/bounty.md` — the demo bounty and what is private about it

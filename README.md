# TaskMarket × STRK20 headless agent

A mainnet demo moving a TaskMarket USDC bounty through the STRK20 privacy pool
and back out to a fresh Base address, driven by a headless agent that owns its
own signer.

1. Create and settle a real TaskMarket USDC bounty on Base with the guarded CLI.
2. Bridge the payout to Starknet and deposit it into the STRK20 pool.
3. Hold and optionally transfer the note privately.
4. Withdraw and bridge back to a fresh Base recipient.

The completed demo implements **agent-side privacy after payout**. TaskMarket
still shows which worker won and received the reward. STRK20 breaks the direct
on-chain ownership link between that public worker wallet and the fresh Base
wallet that ultimately receives the funds. It does not hide the task, worker,
amounts, bridge legs, pool edges, or timing.

The agent holds one low-value EVM key. The Starknet key and the viewing key are
derived from a signature over that key, in memory, on every run — neither is
persisted.

This repository contains the current headless-agent implementation. It does not
mix the earlier Ready Wallet API key model with the agent-owned signer.

## Run

Node 20 or newer.

```bash
scripts/build-deps.sh     # builds the two StarkWare packages from source
npm install
set -a; . live/.env.local; set +a
export NETWORK=mainnet
npm run agent -- preflight
```

`build-deps.sh` is required before the first install: the StarkWare packages
are published to GitHub Packages behind a token, so we build them from public
source into the gitignored `vendor/tarballs/` instead. The script is also the
record of which revisions this demo is pinned to.

Commands:

```bash
npm run agent -- dashboard                       # guarded operator UI at 127.0.0.1:4173
npm run agent -- preflight                       # service reachability, agent EOA
npm run agent -- identity                        # print the agent EOA
npm run agent -- status                          # any in-flight transfer
npm run agent -- deposit <amount> [--resume]     # Base USDC -> pool
npm run agent -- balance                         # public STRK + private USDC
npm run agent -- transfer <amount> <sn-address>  # inside the pool
npm run agent -- withdraw <amount> [base-address] # pool -> agent payout address
```

Run `status` before re-running any deposit or withdrawal that appeared to fail.
A transfer still in flight must be resumed, never reissued.

**Do not chain `deposit` and `withdraw`.** They are separate commands on purpose:
value has to rest in the pool between them. An immediate deposit-then-withdraw of
equal amounts correlates whatever the proof hides, so scripting them together
throws away the property the pool exists to provide.

**Never fund the payout address from anything linkable.** It receives USDC and
holds no gas. Topping it up with ETH from the agent EOA — or from the wallet that
funded the bounty — joins both ends of the round trip on Base. If it ever needs
to spend, the gas must arrive by a path that is not correlatable: a relayer or
meta-transaction submitting on its behalf, so no inbound native transfer is
needed. StarkWare rate this class of leak a hard blocker in their own
integration.

`dashboard` serves ten checkpoints on loopback and places one button beside the
next valid action: submit, accept, deposit/resume, or later withdraw/resume.
Anything it cannot read is shown as unread rather than guessed.

Every button opens a confirmation dialog and remains disabled until the exact
phrase is typed. The server re-reads state before execution, admits only one
action at a time, and invokes a fixed command allowlist without a shell. The
browser receives a per-process action token, never a key or confidential
endpoint. Deposit and withdrawal still run `status` first, and an in-flight
transfer exposes only its resume action. Withdrawal is withheld until a later
dashboard session so deposit and withdrawal cannot be chained in one run.

Run all checks with:

```bash
npm run check
```

## Keys

Two keys, generated separately and never printed:

```bash
npm run new-key          # the agent's funding EOA — fund this one
npm run new-payout-key   # where withdrawals land — receives only
```

Both are written into the gitignored `live/.env.local` at mode 600; only the
derived address is shown. Neither can be regenerated over an existing value: the
funding key derives the Starknet and viewing keys, so replacing it orphans pool
notes, and replacing the payout key strands anything already withdrawn.

The payout key is generated **independently** of the funding key, never derived
from it. Deriving it would tie the agent's public worker identity to where its
earnings land — the exact link the pool exists to break. `withdraw` defaults to
it.

## Configuration

`live/.env.local` is gitignored and holds confidential StarkWare service
endpoints plus the agent key and AVNU credentials. Nothing in it is committed,
logged, or passed as a command-line argument. There is no bundler and no
browser, so no secret has anywhere to leak to.

`bridge-core` hardcodes same-origin paths `/rpc`, `/prover` and `/indexer` with
no env override, which Node's `fetch` rejects. `src/serviceFetch.ts` rewrites
those three prefixes to absolute upstreams and passes every other request
through untouched.

bridge-core also requires the `pre_confirmed` block tag from Starknet RPC 0.9.
Versioned Alchemy v0.6-v0.8 URLs are normalized to v0.9 in memory, without
rewriting the secret-bearing env file. Every bridge-backed command then checks
the reported RPC version and performs a read-only `pre_confirmed` call before it
can continue.

## Verified mainnet demo

The full TaskMarket → Base CCTP → STRK20 → Starknet CCTP → fresh Base wallet
route completed successfully on 2026-08-19. All seven commands are implemented;
84 tests and the typecheck pass.

| Stage | Mainnet transaction | User-visible cost |
|---|---|---:|
| TaskMarket escrow | `0xc8fbc19051c633b83f1266e8a2d2df38f2ac0120fda922e5e551ee63ed3a7b56` | TaskMarket relayer paid gas |
| Work submitted | `0xee5ce1c07078c349b312b058e2c2e2efdca64eb557cc8032bbc7308a5d6da6c5` | TaskMarket relayer paid gas |
| Worker paid | `0xdcbd7ca2e46506c27c5d81dcc9b6e2908f57785042c9949051e6deb67f995145` | 0.4125 USDC platform fee |
| Base CCTP burn | `0x8309a1ac3380439ac5e4494c74d8be72ac715dc70804bece4be682d255b78fb6` | Base gas paid by worker |
| Starknet CCTP mint | `0x6adfe686d85c99c7600fb4dbec6b9bbab0e68db152a48f36cbb43760b582489` | Circle relayer paid gas |
| STRK20 deposit | `0x5b07f9aa62a6bef77c485fdc156b1f919a0e5fe8f061ffb479c00c598754927` | 0.158083 USDC pool/paymaster charge |
| STRK20 withdrawal + CCTP burn | `0x486716f1dac33439bf5bda886d00d224fad649f36fde8f151831f314723aa2d` | 0.157716 USDC pool/paymaster charge |
| Fresh Base wallet funded | `0x079c27145c2cc8160e77aedf3968f37717cb7a9d4d79141b2c982d6d0c3f5718` | 0.053183 USDC Circle fee |

The worker received 5.0875 USDC, deposited 5 USDC, withdrew 4.5 USDC, and the
fresh Base wallet received 4.446817 USDC. The observed privacy-route charge was
0.368982 USDC plus 0.000001418629244155 ETH of worker-paid Base gas. Two of the
three approval transactions were retry overhead from issues fixed during the
demo.

`npm audit --omit=dev` currently reports known transitive advisories through the
pinned upstream StarkWare/CDP dependency graph, including an unpatched
`decompress` path through `starknet-devnet`. Treat this as unaudited demo code,
not a production custody system, and review the dependency report before use.

The version question is settled. The class deployed at the pool address is
`0x67dddd89…`; `PRIVACY-0.14.3-RC.3` and `RC.4` both compile to exactly that
hash, so bridge-core's `0.14.3-rc.3` pin is byte-exact against the live pool.
Note the env doc's class hash (`0x030b8c54…`) does not match what is deployed.

The pool fee needs no STRK in the worker account: `sponsored_private` pays the
Starknet execution cost through a relayer and charges the private balance in
USDC. The worker still needs a little Base ETH for the USDC approval and CCTP
burn.

## A bug worth knowing about

bridge-core persists its in-flight CCTP burn cursors in `localStorage`, and
wraps every read and write in a `try/catch` that swallows failures. Node has no
`localStorage`, so outside a browser those reads return empty, every burn looks
fresh, and a retried deposit burns real USDC a second time — the double-spend
bridge-core's own comments warn about.

`src/storage.ts` is a file-backed Web Storage shim, installed by
`initAgentBridge` before anything can touch a cursor. Anyone running bridge-core
headlessly needs an equivalent; the failure is silent.

## Documents

- [Design](docs/superpowers/specs/2026-08-13-headless-privacy-agent-design.md)
- [Implementation plan](docs/superpowers/plans/2026-08-13-headless-privacy-agent.md)
- [Operator runbook](live/README.md)

## Privacy boundary

TaskMarket activity, the Base payout, the CCTP burn, the public Starknet mint,
the pool deposit amount, and the timing of all of these are public. Privacy
begins inside the pool. Deposits and withdrawals remain observable edges, and
amount and timing correlation still applies. At demo scale — one deposit, one
withdrawal, near-identical amounts, minutes apart — that correlation is enough
to relink the two ends regardless of the cryptography. The pool provides an
unlinkability mechanism; the anonymity comes from other depositors' traffic.

The depositing Starknet account's class hash is also public and can reduce the
effective anonymity set. Connecting to the prover and discovery services
directly, rather than through an OHTTP relay, also exposes the agent's IP
address to those services.

This is an unaudited engineering demo, not an anonymity guarantee.

## Sources

- [TaskMarket worked bounty trace](https://docs.taskmarket.dev/examples/bounty-trace#bootstrap)
- [StarkWare privacy-bridge](https://github.com/starkware-libs/privacy-bridge)
- [STRK20 mainnet Tip Jar example](https://github.com/starkience/strk20-tipjar-example)

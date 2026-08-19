# Claude handoff: TaskMarket × STRK20

> **Current state lives in [AGENTS.md](AGENTS.md)** — read that first. This file
> is the original project brief and is kept for the reasoning behind the design.

## Objective

Build a small **mainnet demo**, not a production launch, showing a TaskMarket bounty funded in USDC on Base, a privacy-preserving route through Starknet STRK20, and a later payout to a fresh Base address.

## Intended flow

1. User creates/funds a TaskMarket escrow bounty with Base USDC.
2. The worker/agent receives the bounty payout on Base.
3. `privacy-bridge`/CCTP moves USDC from Base to Starknet.
4. STRK20 shields the public Starknet USDC into a private pool note.
5. The agent may privately transfer/hold the note.
6. The agent withdraws and bridges USDC to a fresh Base recipient.

The funds remain USDC. Public edges (TaskMarket, Base transfer, CCTP burn/mint, deposit/withdraw timing and amounts) remain visible; privacy begins inside the STRK20 pool. This is not an anonymity guarantee.

## Current workspace implementation

The workspace is a **headless Node agent**. The Ready Wallet API browser demo was retired on 2026-08-13; it is preserved in git history at commit `cd913d9`. Do not mix the two key models.

The agent holds one low-value EVM key and derives its Starknet key and viewing key from a signature over it, in memory, per run. It builds on `@starkware-libs/starknet-privacy-bridge` rather than calling the Privacy SDK directly.

Design and plan:

- [docs/superpowers/specs/2026-08-13-headless-privacy-agent-design.md](docs/superpowers/specs/2026-08-13-headless-privacy-agent-design.md)
- [docs/superpowers/plans/2026-08-13-headless-privacy-agent.md](docs/superpowers/plans/2026-08-13-headless-privacy-agent.md)

Run with `npm ci`, then `set -a; . live/.env.local; set +a`, then `npm run agent -- <command>`. Validate with `npm run check`.

`preflight` and `identity` work. `deposit`, `balance`, `transfer`, `withdraw` and `status` exit non-zero pending GitHub Packages access to `@starkware-libs/starknet-privacy-bridge` (`npm view` returns 403; needs `gh auth refresh -s read:packages`).

## Target headless-agent architecture

For Daydreams agents, use the Privacy SDK directly:

- `@starkware-libs/starknet-privacy-sdk`: private action building, viewing-key use, note discovery, proof client, history.
- `ProvingServiceProofProvider`: points at StarkWare's mainnet proving service.
- `IndexerDiscoveryProvider`: points at StarkWare's mainnet discovery/indexer service.
- `CorePrivateTransfersProver`/`SdkWallet` from `starknet-privacy` are useful adapters for an agent-owned signer and viewing key.
- AVNU SponsoredPrivate/paymaster submits proof-bearing Starknet transactions and sponsors gas.
- `privacy-bridge` handles Base USDC ↔ Starknet via CCTP.

PriPay is the reference implementation: it constructs SDK providers against same-origin `/api/prover` and `/api/discovery` proxies, which forward to StarkWare services; it adds AVNU fee actions before proof generation and proves against roughly `latestBlock - 10`.

## Known dependencies and constants

- Base native USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Starknet native USDC: `0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb`.
- STRK20 mainnet pool: `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`.
- Base CCTP domain: `6`; Starknet CCTP domain: `25`.
- Starknet RPC: user's Alchemy mainnet RPC is available; never commit the API key.
- AVNU paymaster credentials were supplied privately; never print, commit, bundle, or place them in chat-visible files. The headless agent **does** need them: bridge-core's non-paymaster account-deploy path is testnet-only upstream. They belong in the gitignored `live/.env.local` as `AVNU_PAYMASTER_API_KEY`.
- StarkWare mainnet prover and discovery endpoints were supplied privately on 2026-08-13 and are stored in `live/.env.local`. Both verified reachable. Their Pathfinder and Juno full nodes are not reachable from this machine; use the Alchemy RPC.

## Mainnet-demo scope

Do not block the demo on production hardening. We still need a working mainnet prover and discovery/indexer configuration. The public SDK does not bake in these endpoints; it expects provider URLs or provider implementations. PriPay documents StarkWare service hostnames, but confirm current availability and permission before relying on them.

Also create a dedicated low-value agent Starknet signer and encrypted persistent viewing key for the headless path. Never reuse the user's MetaMask key; never put private keys or viewing keys in the repository, frontend bundle, logs, or command arguments.

## Important compatibility note

Pin matching versions across the privacy pool, Privacy SDK and `privacy-bridge`. The workspace's inspected `privacy-bridge` currently used SDK `0.14.3-rc.3`; current `starknet-privacy` source had newer RCs. Do not upgrade one component independently without testing the deployed pool/proof format.

## Immediate next steps

Done: endpoints supplied and health-checked; the architecture decision is made (headless agent on `bridge-core`, Wallet API retired); the CLI skeleton is built and tested.

Blocking the first mainnet run, in order:

1. **GitHub Packages access.** `npm view @starkware-libs/starknet-privacy-bridge` returns `403 permission_denied`. Run `gh auth refresh -s read:packages`, then `npm config set "//npm.pkg.github.com/:_authToken" "$(gh auth token)"`. Until this clears, the dependency cannot be installed and every money-moving command stays stubbed.
2. **SDK revision.** The deployed pool is tagged rc.4 (class hash `0x030b8c54…`); `bridge-core@0.1.18` pins SDK `0.14.3-rc.3`. Ask StarkWare which SDK version matches that class hash before depositing.
3. **OZ account class hash** declared on mainnet. Required by bridge-core, no default, fails loud. The env doc's "Governance Admin (OZ account)" value is an address, not a class hash.
4. Confirm the proof validity window (env doc says 450; bridge-core defaults to 20), whether an OHTTP relay is expected, and the pool fee (marked TBD).
5. Fill `AGENT_EVM_PRIVATE_KEY` in `live/.env.local` with a fresh low-value key, then run one small-value Base → CCTP → Starknet → pool deposit before attempting transfer/withdraw/bridge-back.

## Safety

All money-moving operations require explicit user confirmation. Do not rerun a pending bridge or TaskMarket write with a new idempotency key. Do not use a full wallet balance. This software is an unaudited demo.


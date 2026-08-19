# Bounty: explain the TaskMarket × STRK20 privacy boundary

## Description

> Create a concise Markdown report explaining the privacy boundary when a
> TaskMarket USDC payout on Base is routed through the STRK20 privacy pool on
> Starknet.
>
> Include exactly two sections:
>
> 1. `Public information`
> 2. `Private information`
>
> Requirements:
>
> - 6–10 bullet points total
> - Mention the task, worker address, payout, both CCTP legs, pool deposit, and
>   pool withdrawal
> - Explain that amount and timing correlation may relink a deposit and
>   withdrawal
> - State precisely what STRK20 hides
> - Maximum 250 words
> - Submit one Markdown file
> - Do not claim complete anonymity

- Mode: bounty
- Visibility: unlisted
- Tags: `privacy,starknet,strk20,documentation`
- Reward: `BOUNTY_REWARD_USDC`, default 8 USDC

## Why the reward is 8 USDC

The work is intentionally small. The reward is sized for the integration demo:
after TaskMarket's platform fee, the worker must still have enough Base USDC to
make the planned 5 USDC STRK20 deposit and cover privacy-pool and CCTP fees.

## What the demo proves

The accepted report, worker address, Base payout, bridge transactions, and pool
edges remain public. The privacy claim is narrower: after the payout enters the
pool, STRK20 can break the on-chain link between the public worker wallet and a
later fresh Base recipient. Distinctive amounts and close timing can still
correlate those edges.

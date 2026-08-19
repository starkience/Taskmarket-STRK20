## Public information

- The TaskMarket task, its description, the submitted report, and the report's on-chain deliverable hash are public.
- The worker address that submitted the result and the requester's acceptance of that worker are public.
- The Base USDC payout from TaskMarket to the worker wallet, including its amount and time, is public.
- The inbound CCTP leg from Base to Starknet—burn, attestation, and mint—is publicly observable.
- The STRK20 pool deposit amount, time, depositing Starknet account, and account class are public.
- A later pool withdrawal, the outbound Starknet-to-Base CCTP leg, and the fresh Base recipient are public transactions.

## Private information

- Inside STRK20, note ownership and private transfers are shielded. The proof hides which pool withdrawal spends value originating from a particular pool deposit, breaking the direct on-chain link between the public worker wallet and the fresh Base recipient.
- This is not complete anonymity. A distinctive amount withdrawn soon after a matching deposit can correlate the two public edges despite the proof; delay, shared pool traffic, and common denominations provide the surrounding anonymity.

import { privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";

// Signed once per run; bridge-core derives the Starknet key and the viewing key
// from the resulting signature, in memory. Changing this string changes the pool
// identity and orphans any notes held under the old one, so it is frozen.
export const IDENTITY_MESSAGE = "taskmarket-strk20-agent:v1:pool-identity";

export function loadAgentAccount(env: Record<string, string | undefined>): PrivateKeyAccount {
  const raw = env.AGENT_EVM_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error("AGENT_EVM_PRIVATE_KEY is not set.");
  }
  // Validated without interpolating the value: a malformed key is still key material.
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("AGENT_EVM_PRIVATE_KEY must be 0x followed by 64 hex characters.");
  }
  return privateKeyToAccount(raw as `0x${string}`);
}

export function deriveSignature(account: PrivateKeyAccount): Promise<`0x${string}`> {
  return account.signMessage({ message: IDENTITY_MESSAGE });
}

// Where pool withdrawals land. Generated independently of the funding key, never
// derived from it: deriving it would tie the agent's public worker identity to
// where its earnings end up, which is the link the pool exists to break.
export function loadPayoutAddress(env: Record<string, string | undefined>): string {
  const raw = env.AGENT_PAYOUT_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error("AGENT_PAYOUT_PRIVATE_KEY is not set. Run: npm run new-payout-key");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("AGENT_PAYOUT_PRIVATE_KEY must be 0x followed by 64 hex characters.");
  }
  return privateKeyToAccount(raw as `0x${string}`).address;
}

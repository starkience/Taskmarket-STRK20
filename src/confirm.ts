export interface ConfirmRequest {
  action: string;
  wallet: string;
  amount: string;
  network: string;
}

// The phrase names the amount, so a stale prompt from an earlier run cannot be
// confirmed by muscle memory.
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

export interface EvmCall {
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
  readonly value?: bigint;
}

export interface EvmSendResult {
  readonly txHash: `0x${string}`;
  readonly success: boolean;
}

export interface TxRunner {
  nextNonce?(ctx: { chainId: number; account: `0x${string}` }): Promise<number>;
  send(
    call: EvmCall,
    ctx: { chainId: number; account: `0x${string}`; nonce?: number },
  ): Promise<`0x${string}`>;
  wait(hash: `0x${string}`): Promise<{ success: boolean }>;
}

// bridge-core hands over a batch (typically an ERC-20 approval followed by the
// CCTP burn) and expects one result. A local key has no atomic batching, so the
// calls run sequentially and each is mined before the next is submitted — the
// burn depends on the approval already being on-chain.
export function makeEvmSender(runner: TxRunner) {
  return async function evmSender(
    calls: readonly EvmCall[],
    ctx: { chainId: number; account: `0x${string}`; onStatus?: (s: string) => void },
  ): Promise<EvmSendResult> {
    if (calls.length === 0) {
      throw new Error("evmSender: no calls to submit.");
    }

    // Reserve once for the whole ordered group. Asking a load-balanced RPC for
    // the nonce again immediately after call 1 is mined can return stale state,
    // causing call 2 to reuse the approval nonce as an underpriced replacement.
    // The calls are awaited in order, so incrementing locally is deterministic.
    let nonce = await runner.nextNonce?.({ chainId: ctx.chainId, account: ctx.account });
    let txHash: `0x${string}` | undefined;
    for (const [index, call] of calls.entries()) {
      ctx.onStatus?.(`submitting call ${index + 1} of ${calls.length}`);
      txHash = await runner.send(call, {
        chainId: ctx.chainId,
        account: ctx.account,
        ...(nonce === undefined ? {} : { nonce }),
      });
      if (nonce !== undefined) nonce += 1;
      const { success } = await runner.wait(txHash);
      if (!success) {
        throw new Error(`evmSender: call ${index + 1} of ${calls.length} reverted (${txHash}).`);
      }
    }

    return { txHash: txHash as `0x${string}`, success: true };
  };
}

export interface ServiceUpstreams {
  rpc: string;
  prover: string;
  indexer: string;
}

const PREFIXES: ReadonlyArray<readonly [string, keyof ServiceUpstreams]> = [
  ["/rpc", "rpc"],
  ["/prover", "prover"],
  ["/indexer", "indexer"],
];

const ENV_KEYS: ReadonlyArray<readonly [string, keyof ServiceUpstreams]> = [
  ["STARKNET_RPC_URL", "rpc"],
  ["PROVER_URL", "prover"],
  ["INDEXER_URL", "indexer"],
];

// `pre_confirmed` reads entered the Starknet JSON-RPC specification in v0.9,
// and bridge-core uses that block tag throughout its read and submit paths. The
// configured Alchemy endpoint predates that tag. Keep the secret-bearing URL in
// the env file untouched, but move known versioned Alchemy URLs onto the oldest
// compatible API before any client sees them.
const LEGACY_ALCHEMY_RPC =
  /^(https:\/\/starknet-(?:mainnet|sepolia)\.g\.alchemy\.com\/starknet\/version\/rpc\/)v0_(?:6|7|8)(\/.*)$/i;

export function normalizeStarknetRpcUrl(url: string): string {
  return url.replace(LEGACY_ALCHEMY_RPC, "$1v0_9$2");
}

// For clients we construct ourselves. starknet.js rejects a relative nodeUrl and
// falls back to a public node rather than failing, so anything we build directly
// must be handed the absolute URL instead of the shim's "/rpc".
export function requireRpcUrl(env: Record<string, string | undefined>): string {
  const url = env.STARKNET_RPC_URL?.trim();
  if (!url) throw new Error("STARKNET_RPC_URL is not set.");
  return normalizeStarknetRpcUrl(url).replace(/\/+$/, "");
}

export function readUpstreams(env: Record<string, string | undefined>): ServiceUpstreams {
  const out = {} as ServiceUpstreams;
  for (const [key, field] of ENV_KEYS) {
    const value = env[key]?.trim();
    if (!value) {
      throw new Error(`${key} is not set. bridge-core cannot reach its ${field} service.`);
    }
    // Trailing slashes are stripped here, not at the call sites: the SDK joins
    // paths as `${base}/v1/...`, so a configured "https://host/" yields a double
    // slash, which the discovery service answers with 404 rather than 405.
    out[field] =
      field === "rpc"
        ? normalizeStarknetRpcUrl(value).replace(/\/+$/, "")
        : value.replace(/\/+$/, "");
  }
  return out;
}

export interface StarknetRpcCompatibility {
  specVersion: string;
}

type RpcResponse = {
  result?: unknown;
  error?: { code?: unknown; message?: unknown };
};

async function rpcRequest(
  url: string,
  method: string,
  params: unknown,
  request: typeof globalThis.fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch {
    throw new Error("Starknet RPC compatibility check could not reach the configured endpoint.");
  }

  if (!response.ok) {
    throw new Error(`Starknet RPC compatibility check failed with HTTP ${response.status}.`);
  }

  let payload: RpcResponse;
  try {
    payload = (await response.json()) as RpcResponse;
  } catch {
    throw new Error("Starknet RPC compatibility check returned invalid JSON.");
  }

  if (payload.error || payload.result === undefined) {
    throw new Error(`Starknet RPC does not support the required ${method} request.`);
  }
  return payload.result;
}

// Fund-safety gate for every bridge command. A reachable RPC is not enough:
// bridge-core reads `pre_confirmed`, and an older endpoint otherwise fails only
// after a money-moving flow has begun. The call below is a read-only STRK
// `balanceOf` against the zero address.
export async function assertStarknetRpcCompatibility(
  url: string,
  request: typeof globalThis.fetch = globalThis.fetch,
): Promise<StarknetRpcCompatibility> {
  const spec = await rpcRequest(url, "starknet_specVersion", [], request);
  if (typeof spec !== "string") {
    throw new Error("Starknet RPC returned an invalid specification version.");
  }

  const match = /^(\d+)\.(\d+)/.exec(spec);
  if (!match) {
    throw new Error(`Starknet RPC returned an unrecognised specification version ${spec}.`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major === 0 && minor < 9) {
    throw new Error(
      `Starknet RPC ${spec} is incompatible: bridge-core requires RPC 0.9 or newer.`,
    );
  }

  await rpcRequest(
    url,
    "starknet_call",
    {
      request: {
        contract_address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        entry_point_selector:
          "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e",
        calldata: ["0x0"],
      },
      block_id: "pre_confirmed",
    },
    request,
  );

  return { specVersion: spec };
}

// bridge-core builds same-origin paths ("/prover", "/rpc/mainnet") because it is
// written for a browser behind a dev proxy. Node's fetch rejects relative URLs, so
// map the three known prefixes onto absolute upstreams and leave everything else
// alone. Matching here rather than patching config catches URLs built anywhere in
// the dependency tree.
export function resolveServiceUrl(input: string, upstreams: ServiceUpstreams): string | null {
  for (const [prefix, field] of PREFIXES) {
    if (input !== prefix && !input.startsWith(`${prefix}/`) && !input.startsWith(`${prefix}?`)) {
      continue;
    }
    const base = upstreams[field].replace(/\/+$/, "");
    return `${base}${input.slice(prefix.length)}`;
  }
  return null;
}

// Derived from the ambient fetch rather than the DOM's RequestInfo/RequestInit,
// which do not exist without lib.dom.
export type FetchInput = Parameters<typeof globalThis.fetch>[0];
export type FetchInit = Parameters<typeof globalThis.fetch>[1];

export function installServiceFetch(upstreams: ServiceUpstreams): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: FetchInput, init?: FetchInit) => {
    if (typeof input === "string") {
      const mapped = resolveServiceUrl(input, upstreams);
      if (mapped) return original(mapped, init);
    }
    return original(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

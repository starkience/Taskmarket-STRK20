import {
  bridgeEnvFromRecord,
  getActiveConfig,
  initBridgeConfig,
  type Config,
} from "@starkware-libs/starknet-privacy-bridge/config";
import { installServiceFetch, readUpstreams } from "./serviceFetch";
import { installFileStorage } from "./storage";

// bridge-core keeps its in-flight CCTP burn cursors in localStorage. Gitignored;
// contains public transaction metadata only, never key material.
export const DEFAULT_STATE_FILE = "live/.state/agent-storage.json";

// The pool this demo is pinned to. Deployed class
// 0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d, which both
// PRIVACY-0.14.3-RC.3 and RC.4 compile to. Asserted after init so a bridge-core
// upgrade that re-bakes a different address cannot pass unnoticed.
export const MAINNET_POOL_ADDRESS =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

// BASE_RPC_URL is required for the same reason as STARKNET_RPC_URL: viem and
// bridge-core both fall back to a shared public node when it is unset, so an
// omission silently moves mainnet reads and burns onto an RPC nobody chose.
export const requiredEnv = [
  "STARKNET_RPC_URL",
  "BASE_RPC_URL",
  "PROVER_URL",
  "INDEXER_URL",
  "OZ_ACCOUNT_CLASS_HASH_MAINNET",
] as const;

// Installs the service-URL shim, then hands bridge-core its config. Nothing that
// reads bridge-core config may be imported before this runs.
export function initAgentBridge(env: Record<string, string | undefined>): Config {
  // bridge-core normalizes an unset NETWORK to 'testnet' and would silently use
  // the Sepolia pool. A mainnet-only agent must refuse instead.
  const network = env.NETWORK?.trim().toLowerCase();
  if (!network) {
    throw new Error("NETWORK is not set. Refusing to inherit bridge-core's testnet default.");
  }
  if (network !== "mainnet") {
    throw new Error(`NETWORK must be 'mainnet' for this agent (got ${JSON.stringify(network)}).`);
  }

  for (const key of requiredEnv) {
    if (!env[key]?.trim()) {
      throw new Error(`${key} is not set.`);
    }
  }

  // Before anything that could touch a burn cursor: in Node, bridge-core's
  // localStorage reads and writes are swallowed by its own try/catch, so without
  // this every burn looks fresh and a retry would burn real USDC twice.
  installFileStorage(env.AGENT_STATE_FILE?.trim() || DEFAULT_STATE_FILE);

  installServiceFetch(readUpstreams(env));

  // dev/prod are forced rather than inferred: under dev, bridge-core appends a
  // per-network suffix ('/rpc/mainnet'), which the shim would rewrite onto a
  // path the upstream does not serve.
  initBridgeConfig({ ...bridgeEnvFromRecord(env, ""), dev: false, prod: true });

  const config = getActiveConfig();

  // bridge-core bakes same-origin paths ("/rpc") with no env override. The fetch
  // shim can rewrite those for the prover and indexer, which use fetch directly,
  // but NOT for Starknet: starknet.js validates nodeUrl at construction and falls
  // back to its own public node before fetch is ever reached — so reads would
  // silently come from a node nobody configured. Overwrite all three with the
  // real upstreams; the shim stays as a backstop for anything that builds its
  // own path.
  const upstreams = readUpstreams(env);
  const mutable = config as { rpcUrl: string; proverUrl: string; indexerUrl: string };
  mutable.rpcUrl = upstreams.rpc;
  mutable.proverUrl = upstreams.prover;
  mutable.indexerUrl = upstreams.indexer;

  if (BigInt(config.poolAddress) !== BigInt(MAINNET_POOL_ADDRESS)) {
    throw new Error(`Unexpected pool address ${config.poolAddress}.`);
  }
  return config;
}

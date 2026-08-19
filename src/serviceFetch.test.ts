import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchInput } from "./serviceFetch";
import {
  assertStarknetRpcCompatibility,
  installServiceFetch,
  normalizeStarknetRpcUrl,
  readUpstreams,
  requireRpcUrl,
  resolveServiceUrl,
} from "./serviceFetch";

const upstreams = {
  rpc: "https://rpc.example/v0_10",
  prover: "https://prover.example/",
  indexer: "https://indexer.example/",
};

describe("resolveServiceUrl", () => {
  it("maps each service prefix to its upstream", () => {
    expect(resolveServiceUrl("/rpc", upstreams)).toBe("https://rpc.example/v0_10");
    expect(resolveServiceUrl("/prover", upstreams)).toBe("https://prover.example");
    expect(resolveServiceUrl("/indexer", upstreams)).toBe("https://indexer.example");
  });

  it("preserves the remaining path and query", () => {
    expect(resolveServiceUrl("/indexer/notes?from=7", upstreams)).toBe(
      "https://indexer.example/notes?from=7",
    );
    expect(resolveServiceUrl("/rpc/mainnet", upstreams)).toBe("https://rpc.example/v0_10/mainnet");
  });

  it("returns null for anything that is not a service path", () => {
    expect(resolveServiceUrl("https://iris-api.circle.com/v2/messages", upstreams)).toBeNull();
    expect(resolveServiceUrl("/rpcelicious", upstreams)).toBeNull();
    expect(resolveServiceUrl("/other", upstreams)).toBeNull();
  });
});

describe("readUpstreams", () => {
  it("reads the three service URLs from env", () => {
    expect(
      readUpstreams({
        STARKNET_RPC_URL: "https://rpc.example",
        PROVER_URL: "https://prover.example",
        INDEXER_URL: "https://indexer.example",
      }),
    ).toEqual({
      rpc: "https://rpc.example",
      prover: "https://prover.example",
      indexer: "https://indexer.example",
    });
  });

  it("strips trailing slashes so joined paths do not double up", () => {
    // The SDK joins as `${base}/v1/...`; a configured "https://host/" produced
    // "https://host//v1/..." which the discovery service answers 404, not 405.
    expect(
      readUpstreams({
        STARKNET_RPC_URL: "https://rpc.example/",
        PROVER_URL: "https://prover.example//",
        INDEXER_URL: "https://indexer.example/",
      }),
    ).toEqual({
      rpc: "https://rpc.example",
      prover: "https://prover.example",
      indexer: "https://indexer.example",
    });
  });

  it("moves versioned Alchemy RPC URLs onto the oldest compatible API", () => {
    expect(
      readUpstreams({
        STARKNET_RPC_URL:
          "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_8/redacted-key",
        PROVER_URL: "https://prover.example",
        INDEXER_URL: "https://indexer.example",
      }).rpc,
    ).toBe("https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_9/redacted-key");
  });

  it("fails loudly when one is missing or blank", () => {
    expect(() =>
      readUpstreams({ STARKNET_RPC_URL: "https://rpc.example", PROVER_URL: "  " }),
    ).toThrow(/PROVER_URL/);
    expect(() => readUpstreams({})).toThrow(/STARKNET_RPC_URL/);
  });
});

describe("requireRpcUrl", () => {
  it("returns the absolute URL for clients we construct ourselves", () => {
    // starknet.js rejects a relative nodeUrl and silently falls back to a public
    // node, so a client handed "/rpc" would report balances from an RPC nobody
    // configured. Anything we build directly must get the real URL.
    expect(requireRpcUrl({ STARKNET_RPC_URL: "https://rpc.example" })).toBe("https://rpc.example");
  });

  it("fails loudly rather than letting a client pick its own node", () => {
    expect(() => requireRpcUrl({})).toThrow(/STARKNET_RPC_URL/);
    expect(() => requireRpcUrl({ STARKNET_RPC_URL: "  " })).toThrow(/STARKNET_RPC_URL/);
  });
});

describe("normalizeStarknetRpcUrl", () => {
  it("leaves unrelated providers and compatible Alchemy URLs untouched", () => {
    expect(normalizeStarknetRpcUrl("https://rpc.example/v0_8/key")).toBe(
      "https://rpc.example/v0_8/key",
    );
    expect(
      normalizeStarknetRpcUrl(
        "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_9/key",
      ),
    ).toBe("https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_9/key");
  });
});

describe("assertStarknetRpcCompatibility", () => {
  it("requires both RPC 0.9+ and a working pre_confirmed read", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const request = vi.fn(async (_input: FetchInput, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown };
      calls.push(body);
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: body.method === "starknet_specVersion" ? "0.9.0" : ["0x0", "0x0"],
      });
    }) as typeof fetch;

    await expect(assertStarknetRpcCompatibility("https://rpc.example", request)).resolves.toEqual({
      specVersion: "0.9.0",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.params).toMatchObject({ block_id: "pre_confirmed" });
  });

  it("rejects an older RPC before attempting a pre_confirmed read", async () => {
    const request = vi.fn(async () =>
      Response.json({ jsonrpc: "2.0", id: 1, result: "0.8.1" }),
    ) as typeof fetch;

    await expect(assertStarknetRpcCompatibility("https://rpc.example", request)).rejects.toThrow(
      /RPC 0\.9 or newer/,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects a provider that advertises 0.9 but cannot read pre_confirmed", async () => {
    const request = vi.fn(async (_input: FetchInput, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      return body.method === "starknet_specVersion"
        ? Response.json({ jsonrpc: "2.0", id: 1, result: "0.9.0" })
        : Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32602 } });
    }) as typeof fetch;

    await expect(assertStarknetRpcCompatibility("https://rpc.example", request)).rejects.toThrow(
      /starknet_call/,
    );
  });
});

describe("installServiceFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rewrites service paths and passes other requests through", async () => {
    const seen: string[] = [];
    const inner = vi.fn(async (input: FetchInput) => {
      seen.push(String(input));
      return new Response("{}");
    });
    vi.stubGlobal("fetch", inner);

    const uninstall = installServiceFetch(upstreams);
    await fetch("/prover");
    await fetch("https://iris-api.circle.com/v2/messages");
    uninstall();

    expect(seen).toEqual(["https://prover.example", "https://iris-api.circle.com/v2/messages"]);
  });

  it("restores the original fetch on uninstall", () => {
    const inner = vi.fn();
    vi.stubGlobal("fetch", inner);
    const uninstall = installServiceFetch(upstreams);
    expect(globalThis.fetch).not.toBe(inner);
    uninstall();
    expect(globalThis.fetch).toBe(inner);
  });
});

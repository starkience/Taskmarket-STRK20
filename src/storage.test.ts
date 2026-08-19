import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readInflightBurn } from "@starkware-libs/starknet-privacy-bridge";
import { installFileStorage } from "./storage";

let dir: string;
let file: string;
let uninstall: () => void;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-storage-"));
  file = join(dir, "storage.json");
  uninstall = installFileStorage(file);
});

afterEach(() => {
  uninstall();
  rmSync(dir, { recursive: true, force: true });
});

describe("file-backed storage", () => {
  it("round-trips values and reports misses as null", () => {
    expect(globalThis.localStorage.getItem("absent")).toBeNull();
    globalThis.localStorage.setItem("k", "v");
    expect(globalThis.localStorage.getItem("k")).toBe("v");
  });

  it("persists across a reinstall", () => {
    globalThis.localStorage.setItem("k", "v");
    uninstall();
    uninstall = installFileStorage(file);
    expect(globalThis.localStorage.getItem("k")).toBe("v");
  });

  it("supports removeItem, clear, length and key", () => {
    globalThis.localStorage.setItem("a", "1");
    globalThis.localStorage.setItem("b", "2");
    expect(globalThis.localStorage.length).toBe(2);
    expect(globalThis.localStorage.key(0)).toBe("a");
    globalThis.localStorage.removeItem("a");
    expect(globalThis.localStorage.getItem("a")).toBeNull();
    globalThis.localStorage.clear();
    expect(globalThis.localStorage.length).toBe(0);
  });

  it("writes through to disk immediately", () => {
    // A cursor that only exists in memory is lost on the crash it is meant to
    // survive, so the write must reach disk before the call returns.
    globalThis.localStorage.setItem("k", "v");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ k: "v" });
  });

  it("observes cursor changes written by another process", () => {
    writeFileSync(file, JSON.stringify({ external: "cursor" }), "utf8");
    expect(globalThis.localStorage.getItem("external")).toBe("cursor");
  });

  it("restores the previous global on uninstall", () => {
    uninstall();
    expect("localStorage" in globalThis).toBe(false);
    uninstall = installFileStorage(file);
  });
});

describe("bridge-core's double-burn cursor", () => {
  // Without a storage shim bridge-core's reads and writes are swallowed by its
  // own try/catch, every burn looks fresh, and a retry burns real USDC twice.
  // These assert bridge-core's OWN reader sees what the shim persists.
  const EVM = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
  const burn = {
    burnTxHash: "0xabc123",
    eoaAddress: EVM,
    bidIndex: 0,
    amountHuman: "1.0",
    evmChainId: 8453,
  };

  function writeBurn() {
    globalThis.localStorage.setItem("pmp.inflightBurn", JSON.stringify({ [EVM]: burn }));
  }

  it("is invisible to bridge-core when nothing is stored", () => {
    expect(readInflightBurn(EVM)).toBeNull();
  });

  it("is read back by bridge-core through the shim", () => {
    writeBurn();
    expect(readInflightBurn(EVM)).toMatchObject({ burnTxHash: "0xabc123", eoaAddress: EVM });
  });

  it("survives a restart, so a resumed run finds the burn instead of re-burning", () => {
    writeBurn();
    uninstall();
    uninstall = installFileStorage(file);
    expect(readInflightBurn(EVM)).toMatchObject({ burnTxHash: "0xabc123" });
  });
});

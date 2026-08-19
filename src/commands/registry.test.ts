import { describe, expect, it } from "vitest";
import { COMMANDS, parseCommand, usage } from "./registry";

describe("command parsing", () => {
  it("accepts every advertised command", () => {
    for (const name of COMMANDS) {
      expect(parseCommand([name]).command).toBe(name);
    }
  });

  it("passes trailing arguments through", () => {
    expect(parseCommand(["deposit", "1.5"])).toEqual({ command: "deposit", args: ["1.5"] });
  });

  it("rejects an unknown or missing command", () => {
    expect(() => parseCommand([])).toThrow(/usage/i);
    expect(() => parseCommand(["frobnicate"])).toThrow(/unknown command/i);
  });

  it("lists every command in the usage text", () => {
    for (const name of COMMANDS) {
      expect(usage()).toContain(name);
    }
  });
});

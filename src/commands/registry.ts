export const COMMANDS = [
  "preflight",
  "identity",
  "deposit",
  "balance",
  "transfer",
  "withdraw",
  "status",
  "dashboard",
] as const;

export type CommandName = (typeof COMMANDS)[number];

export function usage(): string {
  return `usage: npm run agent -- <command>\n\ncommands:\n${COMMANDS.map((c) => `  ${c}`).join("\n")}\n`;
}

export function parseCommand(argv: readonly string[]): {
  command: CommandName;
  args: readonly string[];
} {
  const [first, ...args] = argv;
  if (!first) {
    throw new Error(usage());
  }
  if (!(COMMANDS as readonly string[]).includes(first)) {
    throw new Error(`Unknown command: ${first}\n\n${usage()}`);
  }
  return { command: first as CommandName, args };
}

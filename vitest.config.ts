import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["vendor/**", "node_modules/**", "dist/**"],
    server: {
      deps: {
        // bridge-core's dist imports extensionless ('./derivation/index'), which
        // Node's ESM loader rejects. Inlining routes it through Vite's resolver
        // instead. The CLI runs under tsx, which tolerates it; plain `node` does
        // not.
        inline: [/@starkware-libs\//],
      },
    },
  },
});

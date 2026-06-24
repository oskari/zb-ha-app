import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace package to its TypeScript source so the test
      // suite runs on a fresh checkout without a prior `npm run build`
      // (the package's main/exports point only at the built dist/).
      "@zb/expressions": resolve(__dirname, "packages/zb-expressions/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
  },
});

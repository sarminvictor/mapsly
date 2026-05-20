// Vitest config · resolves the @/* path alias (matches tsconfig.json) so
// tests can `import from "@/lib/..."` like app code does.

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.test.{ts,tsx}", "**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/_design/**"],
    // Tests don't need Prisma generated client — every test that touches
    // @/lib/prisma must mock it via vi.mock at the top of the file.
  },
});

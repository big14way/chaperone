import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["checker/test/**/*.test.ts", "agent/test/**/*.test.ts"],
    environment: "node",
  },
});

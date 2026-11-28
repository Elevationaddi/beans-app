import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC keeps decorator metadata, which NestJS dependency injection needs.
const plugins = [swc.vite({ module: { type: "es6" } })];

export default defineConfig({
  test: {
    projects: [
      {
        plugins,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        plugins,
        test: {
          name: "integration",
          include: ["test/**/*.int.test.ts"],
          environment: "node",
          testTimeout: 15_000,
          // Files share one database and the outbox table; run them one at a time so a
          // relay in one file never picks up rows written by another.
          fileParallelism: false,
        },
      },
    ],
  },
});

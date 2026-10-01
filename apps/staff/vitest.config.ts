import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["shell/**/*.test.ts", "i18n/**/*.test.ts", "lib/**/*.test.ts"] } });

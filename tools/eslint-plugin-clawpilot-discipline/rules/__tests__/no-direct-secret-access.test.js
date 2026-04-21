import { RuleTester } from "eslint";
import rule from "../no-direct-secret-access.js";
import { describe, it } from "vitest";

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

describe("no-direct-secret-access", () => {
  it("accepts and rejects the expected patterns", () => {
    tester.run("no-direct-secret-access", rule, {
      valid: [
        { code: 'const v = await secretProvider.get("OPENAI_API_KEY");' },
        { code: "const home = process.env.HOME;" },
        { code: 'fs.readFileSync("./data.json");' },
        {
          // allowlist: legit env provider
          code: "const k = process.env.OPENAI_API_KEY;",
          filename: "/proj/src/core/secrets/providers/env.ts",
        },
        {
          // allowlist: root master key
          code: "const k = process.env.MASTER_ENCRYPTION_KEY;",
          filename: "/proj/src/lib/crypto.ts",
        },
        {
          // allowlist: tests
          code: "const k = process.env.TELEGRAM_BOT_TOKEN;",
          filename: "/proj/src/core/__tests__/foo.test.ts",
        },
      ],
      invalid: [
        {
          code: "const k = process.env.OPENAI_API_KEY;",
          errors: [{ messageId: "env" }],
        },
        {
          code: "const t = process.env.TELEGRAM_BOT_TOKEN;",
          errors: [{ messageId: "env" }],
        },
        {
          code: 'const s = fs.readFileSync("/etc/claw/secret");',
          errors: [{ messageId: "fs" }],
        },
      ],
    });
  });
});

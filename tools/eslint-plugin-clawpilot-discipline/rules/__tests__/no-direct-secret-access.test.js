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
        // generic config files at the repo root must stay legal
        { code: 'fs.readFile("./config/instances.toml");' },
        { code: 'fs.readFileSync("./templates/agent.md");' },
        // a path with `key` in it but no .key extension is fine
        { code: 'fs.readFileSync("/var/lib/keystore/index.json");' },
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
        {
          // allowlist: tests can read .pem fixtures
          code: 'fs.readFileSync("./fixtures/jwt-public.pem");',
          filename: "/proj/src/core/__tests__/jwt-fixture.test.ts",
        },
        {
          // allowlist: Windows path separators — __tests__
          code: "const k = process.env.TELEGRAM_BOT_TOKEN;",
          filename: "C:\\proj\\src\\core\\__tests__\\foo.test.ts",
        },
        {
          // allowlist: Windows path separators — crypto.ts suffix
          code: "const k = process.env.MASTER_ENCRYPTION_KEY;",
          filename: "C:\\proj\\src\\lib\\crypto.ts",
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
        // Newly covered patterns (audit 2026-05 C2):
        {
          code: 'const c = fs.readFileSync("/etc/clawpilot/server.pem");',
          errors: [{ messageId: "fs" }],
        },
        {
          code: 'const k = fs.readFileSync("./config/private.key");',
          errors: [{ messageId: "fs" }],
        },
        {
          code: 'const p = await fs.promises.readFile("/opt/keys/cert.p12");',
          errors: [{ messageId: "fs" }],
        },
        {
          code: 'const p = await fs.promises.readFile("/opt/keys/cert.pfx");',
          errors: [{ messageId: "fs" }],
        },
        {
          code: 'const v = fs.readFileSync("/var/lib/secrets/jwt-signing");',
          errors: [{ messageId: "fs" }],
        },
        {
          code: 'const v = fs.readFileSync("./secret/db-password");',
          errors: [{ messageId: "fs" }],
        },
      ],
    });
  });
});

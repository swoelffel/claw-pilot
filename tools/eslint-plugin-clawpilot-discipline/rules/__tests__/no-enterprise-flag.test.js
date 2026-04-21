import { RuleTester } from "eslint";
import rule from "../no-enterprise-flag.js";
import { describe, it } from "vitest";

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

describe("no-enterprise-flag", () => {
  it("accepts and rejects the expected patterns", () => {
    tester.run("no-enterprise-flag", rule, {
      valid: [
        { code: 'if (capabilities.has("rbac-fine")) { doIt(); }' },
        { code: 'capabilities.require("sso-oidc");' },
        { code: "const tier = product.tier;" }, // tier allowed when not on `license`
        { code: "const x = process.env.HOME;" },
        {
          // allowlist: capabilities.ts itself
          code: "const isEnterprise = true;",
          filename: "/proj/src/core/capabilities.ts",
        },
      ],
      invalid: [
        {
          code: "if (process.env.ENTERPRISE) doIt();",
          errors: [{ messageId: "forbidden" }],
        },
        {
          code: "if (process.env.IS_ENTERPRISE) doIt();",
          errors: [{ messageId: "forbidden" }],
        },
        {
          code: "if (isEnterprise) doIt();",
          errors: [{ messageId: "forbidden" }],
        },
        {
          code: 'if (license.tier === "enterprise") doIt();',
          errors: [{ messageId: "forbidden" }],
        },
        {
          code: "if (user.isPaid) doIt();",
          errors: [{ messageId: "forbidden" }],
        },
      ],
    });
  });
});

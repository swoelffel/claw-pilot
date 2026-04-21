/**
 * no-enterprise-flag — enforces discipline R1.
 *
 * Forbids any proprietary-tier branching in the Community codebase. All
 * differentiation must go through `capabilities.has(...)` / `capabilities.require(...)`
 * (see src/core/capabilities.ts).
 *
 * Forbidden:
 *   - process.env.ENTERPRISE / process.env.ENTERPRISE_* / process.env.IS_ENTERPRISE
 *   - identifiers named `isEnterprise`, `isPaid`, `isPro`
 *   - member accesses `license.tier`, `*.isEnterprise`
 */

const FORBIDDEN_IDENTIFIERS = new Set(["isEnterprise", "isPaid", "isPro"]);
const FORBIDDEN_MEMBER_NAMES = new Set(["isEnterprise", "isPaid", "isPro", "tier"]);
const ENTERPRISE_ENV_PATTERN = /^(ENTERPRISE|IS_ENTERPRISE)(_.*)?$/;

const MESSAGE =
  "Proprietary-tier branching is forbidden (R1). Use `capabilities.has(...)` or `capabilities.require(...)` from src/core/capabilities.ts instead.";

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid proprietary-tier feature flags (R1) — use CapabilityRegistry instead.",
    },
    schema: [],
    messages: { forbidden: MESSAGE },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    // The capability registry itself legitimately references these concepts.
    if (filename.endsWith("src/core/capabilities.ts")) return {};

    return {
      Identifier(node) {
        if (!FORBIDDEN_IDENTIFIERS.has(node.name)) return;
        // Skip when this identifier is the `property` of a MemberExpression
        // (it will be handled by the MemberExpression visitor — avoids
        // double-reporting on e.g. `user.isPaid`).
        const parent = node.parent;
        if (
          parent &&
          parent.type === "MemberExpression" &&
          parent.property === node &&
          !parent.computed
        ) {
          return;
        }
        context.report({ node, messageId: "forbidden" });
      },
      MemberExpression(node) {
        // process.env.ENTERPRISE* / process.env["ENTERPRISE_..."]
        if (
          node.object.type === "MemberExpression" &&
          node.object.object.type === "Identifier" &&
          node.object.object.name === "process" &&
          node.object.property.type === "Identifier" &&
          node.object.property.name === "env"
        ) {
          let envName = null;
          if (!node.computed && node.property.type === "Identifier") {
            envName = node.property.name;
          } else if (
            node.computed &&
            node.property.type === "Literal" &&
            typeof node.property.value === "string"
          ) {
            envName = node.property.value;
          }
          if (envName && ENTERPRISE_ENV_PATTERN.test(envName)) {
            context.report({ node, messageId: "forbidden" });
            return;
          }
        }
        // anything.isEnterprise / license.tier / ...
        if (
          node.property.type === "Identifier" &&
          FORBIDDEN_MEMBER_NAMES.has(node.property.name)
        ) {
          // Skip `capabilities.tier`-style false positives? `tier` is only
          // flagged when accessed from a `license` identifier.
          if (node.property.name === "tier") {
            if (
              node.object.type === "Identifier" &&
              node.object.name === "license"
            ) {
              context.report({ node, messageId: "forbidden" });
            }
            return;
          }
          context.report({ node, messageId: "forbidden" });
        }
      },
    };
  },
};

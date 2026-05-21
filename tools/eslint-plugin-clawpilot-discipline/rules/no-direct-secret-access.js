/**
 * no-direct-secret-access — enforces discipline R5.
 *
 * Forbids reading secrets directly from `process.env.*_SECRET|*_KEY|*_TOKEN|*_PASSWORD`
 * or from filesystem paths that look like a secret store: paths whose name
 * contains `secret`, paths under a `secrets/` directory, paths under `/etc/`
 * whose tail contains `secret`, or files with cryptographic-material
 * extensions (`.pem`, `.key`, `.p12`, `.pfx`). All secret reads must go
 * through `secretProvider.get(name)` (see src/core/secrets, delivered by H4).
 *
 * Allowlist (hard-coded — R5 is a closed set):
 *   - src/core/secrets/providers/env.ts  — the legitimate env-backed provider
 *   - src/lib/crypto.ts                  — root `MASTER_ENCRYPTION_KEY` (chicken/egg)
 *   - any file under **\/__tests__/**    — test fixtures
 *   - any file under src/e2e/**          — integration tests
 */

const SECRET_ENV_PATTERN = /(SECRET|KEY|TOKEN|PASSWORD|API_KEY)$/i;

// Match anything that smells like a secret on disk:
//   - the literal word "secret" (case-insensitive) anywhere in the path
//   - a `secrets/` directory segment (single or plural)
//   - a path under `/etc/` whose tail mentions "secret"
//   - a file extension reserved for cryptographic material
const SECRET_PATH_PATTERNS = [
  /secret/i,
  /(?:^|\/)secrets?\//i,
  /^\/etc\/.*secret/i,
  /\.(?:pem|key|p12|pfx)$/i,
];

function looksLikeSecretPath(value) {
  return SECRET_PATH_PATTERNS.some((re) => re.test(value));
}

const MESSAGE_ENV =
  "Direct secret env read is forbidden (R5). Use `secretProvider.get(name)` from src/core/secrets instead.";
const MESSAGE_FS =
  "Direct secret file read is forbidden (R5). Use `secretProvider.get(name)` from src/core/secrets instead.";

const ALLOWLIST_SUFFIXES = ["src/core/secrets/providers/env.ts", "src/lib/crypto.ts"];

function isAllowlisted(filename) {
  if (!filename) return false;
  const normalized = filename.replace(/\\/g, "/");
  if (normalized.includes("/__tests__/")) return true;
  if (normalized.includes("/src/e2e/")) return true;
  return ALLOWLIST_SUFFIXES.some((s) => normalized.endsWith(s));
}

function isFsReadCall(node) {
  // fs.readFileSync(...) / fs.readFile(...) / fs.promises.readFile(...)
  const callee = node.callee;
  if (callee.type !== "MemberExpression") return false;
  if (callee.property.type !== "Identifier") return false;
  if (!callee.property.name.startsWith("readFile")) return false;
  return true;
}

function firstStringArg(node) {
  const arg = node.arguments[0];
  if (!arg) return null;
  if (arg.type === "Literal" && typeof arg.value === "string") return arg.value;
  if (arg.type === "TemplateLiteral") {
    return arg.quasis.map((q) => q.value.cooked).join("");
  }
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid direct secret access (R5) — use SecretProvider instead.",
    },
    schema: [],
    messages: { env: MESSAGE_ENV, fs: MESSAGE_FS },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? "";
    if (isAllowlisted(filename)) return {};

    return {
      MemberExpression(node) {
        // Target: `process.env.<NAME>` or `process.env["<NAME>"]`
        if (
          !(
            node.object.type === "MemberExpression" &&
            node.object.object.type === "Identifier" &&
            node.object.object.name === "process" &&
            node.object.property.type === "Identifier" &&
            node.object.property.name === "env"
          )
        ) {
          return;
        }
        // Resolve the key name — skip dynamic lookups like `process.env[key]`.
        let name = null;
        if (!node.computed && node.property.type === "Identifier") {
          name = node.property.name;
        } else if (
          node.computed &&
          node.property.type === "Literal" &&
          typeof node.property.value === "string"
        ) {
          name = node.property.value;
        }
        if (name && SECRET_ENV_PATTERN.test(name)) {
          context.report({ node, messageId: "env" });
        }
      },
      CallExpression(node) {
        if (!isFsReadCall(node)) return;
        const arg = firstStringArg(node);
        if (arg && looksLikeSecretPath(arg)) {
          context.report({ node, messageId: "fs" });
        }
      },
    };
  },
};

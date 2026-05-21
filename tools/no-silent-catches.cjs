// Pre-push gate: forbid empty catch blocks (`catch {`) in production code.
// Cross-platform replacement for the bash grep pipeline.
"use strict";

const fs = require("fs");
const path = require("path");

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, cb);
    } else if (entry.name.endsWith(".ts")) {
      cb(full);
    }
  }
}

const hits = [];

walk("src", (file) => {
  const normalized = file.replace(/\\/g, "/");
  if (normalized.includes("/__tests__/") || normalized.includes("/e2e/")) return;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, idx) => {
    if (line.includes("catch {")) {
      hits.push(`${file}:${idx + 1}`);
    }
  });
});

if (hits.length > 0) {
  console.error(`Found ${hits.length} silent catch(es):\n${hits.join("\n")}`);
  process.exit(1);
}

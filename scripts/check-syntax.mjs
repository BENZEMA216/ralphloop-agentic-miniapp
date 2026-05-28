import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const ignoredDirectories = new Set([".git", "node_modules", "coverage", "dist", ".next", "agora-demo"]);
const checkedExtensions = new Set([".js", ".mjs", ".cjs", ".ts"]);

function extensionOf(path) {
  const match = path.match(/\.[^.]+$/);
  return match ? match[0] : "";
}

function collectFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) {
      continue;
    }

    const path = join(directory, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      files.push(...collectFiles(path));
      continue;
    }

    if (checkedExtensions.has(extensionOf(path))) {
      files.push(path);
    }
  }

  return files;
}

const files = collectFiles(root);
let failed = false;

for (const file of files) {
  const args = extensionOf(file) === ".ts"
    ? ["--experimental-strip-types", "--check", file]
    : ["--check", file];
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });

  if (result.status !== 0) {
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const repoRoot = resolve(packageDir, "..", "..");
const distDir = join(packageDir, "dist");

function readDirRecursive(root: string, results: string[] = []): string[] {
  if (!existsSync(root)) {
    return results;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const next = join(root, entry.name);
    if (entry.isDirectory()) {
      readDirRecursive(next, results);
    } else {
      results.push(next);
    }
  }
  return results;
}

test("apps/share-web-react build emits index.html and a hashed JS bundle", () => {
  const result = spawnSync("npm", ["run", "build:web-react", "--silent"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "production" },
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(
      `build:web-react failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }

  const indexPath = join(distDir, "index.html");
  assert.equal(existsSync(indexPath), true, "dist/index.html must exist");
  assert.equal(statSync(indexPath).size > 0, true, "dist/index.html must not be empty");

  const allFiles = readDirRecursive(distDir);
  const hashedJsFiles = allFiles.filter((file) =>
    /\/assets\/.+-[A-Za-z0-9_]{6,}\.js$/.test(file),
  );
  assert.equal(
    hashedJsFiles.length > 0,
    true,
    `expected at least one hashed JS asset under dist/assets/, found: ${allFiles.join("\n")}`,
  );
});

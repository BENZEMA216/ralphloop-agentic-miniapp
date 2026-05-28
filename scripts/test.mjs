import { existsSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ignoredDirectories = new Set([".git", "node_modules", "coverage", "dist", ".next"]);
const testFilePattern = /\.test\.(js|mjs|cjs|ts)$/;
const args = process.argv.slice(2);
const defaultTestRoots = ["apps"];

async function collectTests(path) {
  if (!existsSync(path)) {
    return [path];
  }

  const stat = statSync(path);
  if (stat.isFile()) {
    return [path];
  }

  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTests(entryPath));
      continue;
    }

    if (testFilePattern.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

const roots = args.length > 0 ? args : defaultTestRoots;
const targets = (await Promise.all(roots.map(collectTests))).flat();
const nodeArgs = ["--experimental-strip-types", "--test", ...targets];
const result = spawnSync(process.execPath, nodeArgs, { stdio: "inherit" });
process.exit(result.status ?? 1);

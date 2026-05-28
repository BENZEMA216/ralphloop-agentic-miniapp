/**
 * Pixel baseline diff harness (Workstream G.3).
 *
 * Pure-JS PNG diff backed by `pngjs` (decode/encode) + `pixelmatch` (per-pixel
 * delta). We deliberately do NOT pull in Playwright's heavyweight image
 * comparator: it ships an ImageMagick binary on some platforms and forces a
 * specific test runner. Our needs are simpler — compare a freshly captured
 * PNG against a committed baseline and fail if more than `maxDiffRatio` of
 * the pixels diverge.
 *
 * Workflow:
 *   1. Test captures a PNG via the existing CDP harness.
 *   2. Calls `comparePngToBaseline({ name, current, baselineDir })`.
 *   3. On `UPDATE_BASELINES=1`, the helper writes `current` to the baseline
 *      path and returns ok. Use this to seed baselines once.
 *   4. Otherwise it loads the baseline, compares, and returns
 *      `{ ok, diffRatio, diffPath? }`. `ok` is true when the baseline does
 *      not exist (regeneration path) or when `diffRatio <= maxDiffRatio`.
 *      On failure a diff PNG is written next to the baseline so the QA
 *      engineer can eyeball what changed.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface CompareOptions {
  /** Logical name used to derive the baseline filename (e.g. "empty-thread"). */
  name: string;
  /** Freshly captured PNG bytes (raw, decoded form is computed internally). */
  current: Buffer;
  /** Directory holding committed `<name>.png` baselines. */
  baselineDir: string;
  /**
   * Maximum allowed fraction of differing pixels before the comparison fails.
   * Defaults to 0.02 (2%).
   */
  maxDiffRatio?: number;
}

export interface CompareResult {
  /** True when the comparison passed (or we just wrote a baseline). */
  ok: boolean;
  /** Fraction of differing pixels in [0, 1]. 0 when we just wrote a baseline. */
  diffRatio: number;
  /** Path to the generated diff PNG, only set when comparison fails. */
  diffPath?: string;
}

const DEFAULT_MAX_DIFF_RATIO = 0.02;

export async function comparePngToBaseline(options: CompareOptions): Promise<CompareResult> {
  const safeName = sanitizeName(options.name);
  const baselinePath = join(options.baselineDir, `${safeName}.png`);
  const updateMode = process.env.UPDATE_BASELINES === "1";

  if (updateMode || !existsSync(baselinePath)) {
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, options.current);
    return { ok: true, diffRatio: 0 };
  }

  const baselineBytes = await readFile(baselinePath);
  const baselineImage = PNG.sync.read(baselineBytes);
  const currentImage = PNG.sync.read(options.current);

  if (baselineImage.width !== currentImage.width || baselineImage.height !== currentImage.height) {
    const diffPath = await writeDimensionMismatchDiff({
      baselineDir: options.baselineDir,
      name: safeName,
      currentBytes: options.current,
    });
    return {
      ok: false,
      diffRatio: 1,
      diffPath,
    };
  }

  const { width, height } = baselineImage;
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(
    baselineImage.data,
    currentImage.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 },
  );

  const totalPixels = width * height;
  const diffRatio = totalPixels === 0 ? 0 : mismatched / totalPixels;
  const maxDiffRatio = options.maxDiffRatio ?? DEFAULT_MAX_DIFF_RATIO;

  if (diffRatio <= maxDiffRatio) {
    return { ok: true, diffRatio };
  }

  const diffPath = join(options.baselineDir, `${safeName}.diff.png`);
  await mkdir(dirname(diffPath), { recursive: true });
  await writeFile(diffPath, PNG.sync.write(diff));
  return { ok: false, diffRatio, diffPath };
}

async function writeDimensionMismatchDiff(input: {
  baselineDir: string;
  name: string;
  currentBytes: Buffer;
}): Promise<string> {
  const diffPath = join(input.baselineDir, `${input.name}.diff.png`);
  await mkdir(dirname(diffPath), { recursive: true });
  // Persist the new capture next to the baseline so reviewers can see the new
  // shape directly. We can't render a per-pixel diff with mismatched sizes.
  await writeFile(diffPath, input.currentBytes);
  return diffPath;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

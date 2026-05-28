import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

type PendingMessage = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type CdpPage = {
  close(): void;
  evaluate<T>(expression: string): Promise<T>;
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  consoleErrors: string[];
  exceptions: string[];
};

export type BrowserRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export type BrowserLayoutMetrics = {
  viewport: { width: number; height: number };
  document: { scrollWidth: number; clientWidth: number };
};

export type BrowserPage = Awaited<ReturnType<typeof launchChrome>>;

export function assertNoDocumentHorizontalOverflow(metrics: BrowserLayoutMetrics) {
  assert.equal(metrics.document.scrollWidth <= metrics.viewport.width + 1, true);
  assert.equal(metrics.document.clientWidth <= metrics.viewport.width + 1, true);
}

export function assertRectInsideViewport(rect: BrowserRect, viewportWidth: number) {
  assert.equal(rect.left >= -1, true);
  assert.equal(rect.right <= viewportWidth + 1, true);
  assert.equal(rect.width > 0, true);
}

export async function launchChrome() {
  const chromePath = findChromePath();
  assert.ok(chromePath, "Chrome executable not found");

  const userDataDir = await mkdtemp(join(tmpdir(), "ralphloop-chrome-"));
  const debuggingPort = await getOpenPort();
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--no-default-browser-check",
    "--no-first-run",
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let page: CdpPage;
  try {
    page = await connectToFirstPage(debuggingPort);
  } catch (error) {
    chrome.kill("SIGTERM");
    await waitForExit(chrome);
    await rm(userDataDir, { force: true, recursive: true });
    throw error;
  }
  let closed = false;

  return {
    consoleErrors: page.consoleErrors,
    exceptions: page.exceptions,
    async navigate(url: string) {
      await page.send("Page.navigate", { url });
      await this.waitForExpression("document.readyState === 'complete'");
    },
    async evaluate<T>(expression: string) {
      return await page.evaluate<T>(expression);
    },
    async setViewport(input: { width: number; height: number; mobile: boolean }) {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: input.width,
        height: input.height,
        deviceScaleFactor: 1,
        mobile: input.mobile,
      });
    },
    async captureScreenshot() {
      const result = await page.send<{ data?: string }>("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
      });
      return result.data ?? "";
    },
    async waitForExpression(expression: string, timeoutMs = 5_000) {
      const startedAt = Date.now();
      let lastError = "";
      while (Date.now() - startedAt < timeoutMs) {
        try {
          if (await page.evaluate<boolean>(`Boolean(${expression})`)) {
            return;
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
        await delay(50);
      }
      throw new Error(`Timed out waiting for browser expression: ${expression}${lastError ? ` (${lastError})` : ""}`);
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      page.close();
      chrome.kill("SIGTERM");
      await waitForExit(chrome);
      await rm(userDataDir, { force: true, recursive: true });
    },
  };
}

export async function saveBrowserScreenshot(input: {
  browser: BrowserPage;
  artifactName: string;
  directory?: string;
}): Promise<string> {
  const directory = input.directory ?? join(process.cwd(), ".gstack", "qa-reports", "browser-screenshots");
  await mkdir(directory, { recursive: true });
  const safeName = input.artifactName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const filePath = join(directory, `${safeName}.png`);
  const screenshot = await input.browser.captureScreenshot();
  assert.ok(screenshot.length > 10_000);
  await writeFile(filePath, Buffer.from(screenshot, "base64"));
  return filePath;
}

/**
 * Archive a screenshot of `page` to `<archiveDir>/<name>.png`. The directory
 * is created lazily. Unlike `saveBrowserScreenshot`, this helper does not
 * pre-assert on PNG length — callers can apply their own size threshold (the
 * owner archive test uses >4 KB to catch empty PNGs).
 *
 * Returns the absolute file path the PNG was written to.
 */
export async function archiveScreenshot(input: {
  page: BrowserPage;
  name: string;
  archiveDir: string;
}): Promise<string> {
  await mkdir(input.archiveDir, { recursive: true });
  const safeName = input.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const filePath = join(input.archiveDir, `${safeName}.png`);
  const screenshot = await input.page.captureScreenshot();
  await writeFile(filePath, Buffer.from(screenshot, "base64"));
  return filePath;
}

export function findChromePath(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate));
}

async function connectToFirstPage(port: number): Promise<CdpPage> {
  const startedAt = Date.now();
  let targets: Array<{ type: string; webSocketDebuggerUrl?: string }> = [];
  while (Date.now() - startedAt < 15_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      targets = await response.json() as Array<{ type: string; webSocketDebuggerUrl?: string }>;
      if (targets.some((target) => target.type === "page" && target.webSocketDebuggerUrl)) {
        break;
      }
      const opened = await openNewPageTarget(port);
      if (opened?.webSocketDebuggerUrl) {
        targets = [opened, ...targets];
        break;
      }
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }

  const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  assert.ok(pageTarget?.webSocketDebuggerUrl, "Chrome page target not available");

  const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Failed to connect to Chrome DevTools")), { once: true });
  });

  let nextMessageId = 0;
  const pending = new Map<number, PendingMessage>();
  const consoleErrors: string[] = [];
  const exceptions: string[] = [];

  socket.addEventListener("message", (event) => {
    void normalizeMessageData(event.data).then((raw) => {
      const message = JSON.parse(raw) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: { message?: string };
      };
      if (typeof message.id === "number") {
        const handler = pending.get(message.id);
        if (!handler) {
          return;
        }
        pending.delete(message.id);
        if (message.error) {
          handler.reject(new Error(message.error.message ?? "Chrome DevTools command failed"));
          return;
        }
        handler.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params?.exceptionDetails as { text?: string } | undefined;
        exceptions.push(details?.text ?? "Runtime exception");
      }
      if (message.method === "Runtime.consoleAPICalled") {
        const params = message.params as { type?: string; args?: Array<{ value?: unknown; description?: string }> } | undefined;
        if (params?.type === "error") {
          consoleErrors.push((params.args ?? []).map((arg) => String(arg.value ?? arg.description ?? "")).join(" "));
        }
      }
    }).catch((error) => {
      exceptions.push(error instanceof Error ? error.message : String(error));
    });
  });

  const page: CdpPage = {
    consoleErrors,
    exceptions,
    close() {
      socket.close();
    },
    send<T = unknown>(method: string, params: Record<string, unknown> = {}) {
      nextMessageId += 1;
      const id = nextMessageId;
      const promise = new Promise<T>((resolve, reject) => {
        pending.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
        });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return promise;
    },
    async evaluate<T>(expression: string) {
      const result = await page.send<{
        result?: { value?: T; description?: string };
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      }>("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Evaluation failed");
      }
      return result.result?.value as T;
    },
  };

  await page.send("Runtime.enable");
  await page.send("Page.enable");
  return page;
}

async function openNewPageTarget(port: number): Promise<{ type: string; webSocketDebuggerUrl?: string } | undefined> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
    if (!response.ok) {
      return undefined;
    }
    const target = await response.json() as { type?: string; webSocketDebuggerUrl?: string };
    if (!target.webSocketDebuggerUrl) {
      return undefined;
    }
    return {
      type: target.type ?? "page",
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    };
  } catch {
    return undefined;
  }
}

async function normalizeMessageData(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer).toString("utf8");
  }
  if (data instanceof Blob) {
    return await data.text();
  }
  return String(data);
}

async function getOpenPort(): Promise<number> {
  const net = await import("node:net");
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

async function waitForExit(process: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) {
    return;
  }
  await Promise.race([
    new Promise<void>((resolve) => process.once("exit", () => resolve())),
    delay(2_000).then(() => {
      process.kill("SIGKILL");
    }),
  ]);
}

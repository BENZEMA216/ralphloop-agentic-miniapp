import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";

import type { AgentAdapter } from "../adapters/types.ts";
import type { AgentAdapterInfo } from "../adapters/types.ts";
import { listOwnerAdapters } from "../routes/adapters.ts";
import { ShareLinkStore, createOwnerShareLink, getSharedAgentPage } from "../routes/shareLinks.ts";
import { submitSharedTask } from "../routes/tasks.ts";
import { createOwnerPageModel } from "../../../share-web/src/pages/owner/index.ts";
import { createSharePageModel } from "../../../share-web/src/pages/share/[token].ts";

type ShareRuntimeServerOptions = {
  baseUrl?: string;
  tokenFactory?: () => string;
  adapters?: Record<string, AgentAdapter>;
  adapterInventory?: AgentAdapterInfo[];
};

type ServerHandle = {
  listen(port: number): Promise<void>;
  url(): string;
  close(): Promise<void>;
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response>;
};

export function createShareRuntimeServer(options: ShareRuntimeServerOptions = {}): ServerHandle {
  const store = new ShareLinkStore();
  const adapters = options.adapters ?? { opencode: fakeOpenCodeAdapter() };
  const adapterInventory = options.adapterInventory ?? [openCodeInfo()];
  let server: Server | undefined;
  let inProcessUrl: string | undefined;

  return {
    async listen(port: number) {
      server = createServer((request, response) => {
        void handleRequest({
          request,
          response,
          store,
          adapters,
          adapterInventory,
          tokenFactory: options.tokenFactory,
          baseUrl: options.baseUrl,
        });
      });

      try {
        await new Promise<void>((resolve, reject) => {
          server?.listen(port, "127.0.0.1", () => resolve());
          server?.once("error", (error) => reject(error));
        });
      } catch (error) {
        const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
        if (code !== "EPERM") {
          throw error;
        }
        const resolvedPort = port === 0 ? 0 : port;
        inProcessUrl = `http://127.0.0.1:${resolvedPort}`;
        server = undefined;
      }
    },
    url() {
      if (inProcessUrl) {
        return inProcessUrl;
      }
      if (!server) {
        throw new Error("Server has not been started");
      }
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Server address is unavailable");
      }
      return `http://127.0.0.1:${address.port}`;
    },
    async close() {
      if (!server) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
            if (code === "ERR_SERVER_NOT_RUNNING") {
              resolve();
              return;
            }
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    async fetch(url: string, init) {
      if (!inProcessUrl) {
        return globalThis.fetch(url, init as RequestInit);
      }
      return dispatchInProcess({
        url,
        init,
        store,
        adapters,
        adapterInventory,
        tokenFactory: options.tokenFactory,
        baseUrl: options.baseUrl,
      });
    },
  };
}

async function dispatchInProcess(input: {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
  store: ShareLinkStore;
  adapters: Record<string, AgentAdapter>;
  adapterInventory: AgentAdapterInfo[];
  tokenFactory?: () => string;
  baseUrl?: string;
}): Promise<Response> {
  const targetUrl = new URL(input.url, "http://127.0.0.1");
  const method = input.init?.method ?? "GET";
  const headers = Object.fromEntries(
    Object.entries(input.init?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  headers.host = headers.host ?? targetUrl.host;

  const requestStream = new PassThrough();
  const request = requestStream as unknown as IncomingMessage;
  (request as unknown as { method: string }).method = method;
  (request as unknown as { url: string }).url = `${targetUrl.pathname}${targetUrl.search}`;
  (request as unknown as { headers: Record<string, string> }).headers = headers;

  let status = 200;
  let responseHeaders: Record<string, string> = {};
  const chunks: Buffer[] = [];
  const responseDone = new Promise<void>((resolve) => {
    const response = {
      writeHead(code: number, headerValues?: Record<string, string>) {
        status = code;
        if (headerValues) {
          responseHeaders = {
            ...responseHeaders,
            ...Object.fromEntries(Object.entries(headerValues).map(([key, value]) => [key.toLowerCase(), value])),
          };
        }
      },
      end(chunk?: unknown) {
        if (chunk !== undefined) {
          chunks.push(Buffer.from(String(chunk)));
        }
        resolve();
      },
    } as unknown as ServerResponse;

    void handleRequest({
      request,
      response,
      store: input.store,
      adapters: input.adapters,
      adapterInventory: input.adapterInventory,
      tokenFactory: input.tokenFactory,
      baseUrl: input.baseUrl,
    });
  });

  process.nextTick(() => {
    const body = input.init?.body;
    if (body !== undefined) {
      requestStream.end(body);
      return;
    }
    requestStream.end();
  });

  await responseDone;
  return new Response(Buffer.concat(chunks), { status, headers: responseHeaders });
}

async function handleRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  store: ShareLinkStore;
  adapters: Record<string, AgentAdapter>;
  adapterInventory: AgentAdapterInfo[];
  tokenFactory?: () => string;
  baseUrl?: string;
}) {
  const url = new URL(input.request.url ?? "/", `http://${input.request.headers.host ?? "127.0.0.1"}`);

  if (input.request.method === "GET" && url.pathname === "/owner") {
    const adapterResponse = await listOwnerAdapters({
      detectAll: async () => input.adapterInventory,
    });
    const page = createOwnerPageModel({
      adapters: adapterResponse.body.adapters,
      baseUrl: originFor(input.request, input.baseUrl),
    });
    sendHtml(input.response, adapterResponse.status, renderOwnerPage(page));
    return;
  }

  if (input.request.method === "GET" && url.pathname === "/owner/adapters") {
    const adapterResponse = await listOwnerAdapters({
      detectAll: async () => input.adapterInventory,
    });
    sendJson(input.response, adapterResponse.status, adapterResponse.body);
    return;
  }

  if (input.request.method === "POST" && url.pathname === "/owner/share-links") {
    const response = createOwnerShareLink({
      store: input.store,
      input: { adapterId: "opencode" },
      tokenFactory: input.tokenFactory,
    });
    sendJson(input.response, response.status, response.body);
    return;
  }

  const shareMatch = url.pathname.match(/^\/share\/([^/]+)$/);
  if (input.request.method === "GET" && shareMatch) {
    const token = decodeURIComponent(shareMatch[1]);
    const response = getSharedAgentPage({ store: input.store, token });
    if (!response.body.available) {
      sendJson(input.response, response.status, response.body);
      return;
    }

    const page = createSharePageModel({
      token,
      agent: response.body.agent,
    });
    sendHtml(input.response, response.status, renderSharePage(page));
    return;
  }

  const taskMatch = url.pathname.match(/^\/share\/([^/]+)\/tasks$/);
  if (input.request.method === "POST" && taskMatch) {
    const body = await readJsonBody(input.request);
    const response = await submitSharedTask({
      store: input.store,
      token: decodeURIComponent(taskMatch[1]),
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      adapters: input.adapters,
    });
    sendJson(input.response, response.status, response.body);
    return;
  }

  sendJson(input.response, 404, { error: "not_found" });
}

function renderOwnerPage(page: ReturnType<typeof createOwnerPageModel>): string {
  const options = page.adapterPicker.options
    .map((option) => `<li>${escapeHtml(option.label)} ${option.disabled ? "(unavailable)" : ""}</li>`)
    .join("");
  const createEndpoint = JSON.stringify("/owner/share-links");
  return htmlPage("Owner", `
    <main>
      <h1>Agent Share</h1>
      <section aria-label="Adapters"><ul>${options}</ul></section>
      <button id="create-share-link" ${page.canGenerateShareLink ? "" : "disabled"}>生成分享链接</button>
      <p><a id="share-link"></a></p>
    </main>
    <script>
      const createButton = document.getElementById("create-share-link");
      const shareLink = document.getElementById("share-link");
      createButton?.addEventListener("click", async () => {
        createButton.setAttribute("disabled", "true");
        const response = await fetch(${createEndpoint}, { method: "POST" });
        const body = await response.json();
        const url = new URL("/share/" + body.shareLink.token, window.location.origin).toString();
        shareLink.href = url;
        shareLink.textContent = url;
        createButton.removeAttribute("disabled");
      });
    </script>
  `);
}

function renderSharePage(page: ReturnType<typeof createSharePageModel>): string {
  const submitEndpoint = JSON.stringify(`/share/${encodeURIComponent(page.token)}/tasks`);
  return htmlPage("Share", `
    <main>
      <h1>${escapeHtml(page.agentName)}</h1>
      <aside data-testid="friend-session-sidebar"><button type="button">${escapeHtml(page.sessionSidebar.newSessionLabel)}</button></aside>
      <section data-testid="friend-chat-shell">
        <section id="chat-thread" data-testid="friend-chat-thread" aria-label="Agent Chat"></section>
        <form id="chat-form" data-testid="friend-chat-composer">
          <textarea name="prompt" aria-label="消息" placeholder="${escapeHtml(page.chatComposer.placeholder)}"></textarea>
          <button>${escapeHtml(page.chatComposer.submitLabel)}</button>
        </form>
        <section id="chat-status" aria-label="状态">${escapeHtml(page.chatThread.statusLabel)}</section>
      </section>
      <section data-testid="friend-preview-drawer" aria-label="预览">${page.previewDrawer.readOnly ? "只读预览" : "交互预览"}</section>
    </main>
    <script>
      const chatForm = document.getElementById("chat-form");
      const chatStatus = document.getElementById("chat-status");
      const chatThread = document.getElementById("chat-thread");
      chatForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(chatForm);
        const response = await fetch(${submitEndpoint}, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: String(data.get("prompt") ?? "") }),
        });
        const body = await response.json();
        chatStatus.textContent = body.task?.status === "running" ? "运行中" : "失败";
        chatThread.textContent = body.task?.id ? "任务已接收：" + body.task.id : "任务提交失败";
      });
    </script>
  `);
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;
}

function sendHtml(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function originFor(request: IncomingMessage, override?: string): string {
  if (override && !override.endsWith(":0")) {
    return override;
  }
  return `http://${request.headers.host ?? "127.0.0.1"}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        resolve(parsed && typeof parsed === "object" ? parsed : {});
      } catch {
        resolve({});
      }
    });
  });
}

function openCodeInfo(): AgentAdapterInfo {
  return {
    id: "opencode",
    displayName: "OpenCode",
    status: "available",
    version: "1.2.27",
    startCapability: "server",
    taskCapability: "server_api",
    eventCapability: "http_events",
    desktopPreviewCapability: "web",
  };
}

function fakeOpenCodeAdapter(): AgentAdapter {
  return {
    async detect() {
      return openCodeInfo();
    },
    async start() {
      return {
        adapterId: "opencode",
        runtimeId: "opencode:runtime",
        status: "running",
      };
    },
    async submitTask() {
      return {
        adapterId: "opencode",
        runtimeId: "opencode:runtime",
        taskId: "task-1",
        status: "running",
      };
    },
    async *streamEvents(input) {
      yield { type: "task.accepted", taskId: input.task.taskId };
    },
    async stop() {},
  };
}

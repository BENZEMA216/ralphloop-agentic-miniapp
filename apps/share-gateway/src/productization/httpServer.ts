import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve as resolvePath, sep } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { createAssistantUiShareClientScript } from "../../../share-web/src/pages/share/assistantUiClientScript.ts";
import { AdapterRegistry } from "../adapters/registry.ts";
import type { AgentAdapterInfo, RuntimeEvent } from "../adapters/types.ts";
import { HostRuntimeRegistry } from "./hostRuntime.ts";
import { RelayStore } from "./relayStore.ts";
import { generateDeviceKey, hashDeviceKey } from "./token.ts";
import {
  cancelFriendSessionV1,
  cancelOwnerSessionV1,
  claimHostCommandV1,
  createFriendSessionV1,
  createOwnerShareLinkV1,
  getFriendPreviewV1,
  getFriendSharePageV1,
  getFriendTaskEventsV1,
  listOwnerAdaptersV1,
  listFriendConfirmationsV1,
  listOwnerAuditLogsV1,
  listOwnerApprovalRequestsV1,
  listOwnerHostsV1,
  listOwnerShareLinksV1,
  listOwnerSessionsV1,
  listOwnerTasksV1,
  pauseOwnerShareLinkByIdV1,
  recordHostHeartbeat,
  recordHostCommandEventsV1,
  registerHost,
  resolveFriendConfirmationV1,
  resolveOwnerApprovalRequestV1,
  revokeOwnerShareLinkByIdV1,
  resumeOwnerShareLinkByIdV1,
  startFriendAuthV1,
  submitFriendTaskV1,
  updateOwnerShareLinkV1,
} from "./routes.ts";
import type { ApprovalRequestRecord } from "./types.ts";

type ProductizedShareServerOptions = {
  store?: RelayStore;
  runtimes?: HostRuntimeRegistry;
  adapterInventory?: { detectAll(): Promise<AgentAdapterInfo[]> };
  tokenFactory?: () => string;
  hostBootstrapSecret?: string;
};

type ServerHandle = {
  listen(port: number): Promise<void>;
  url(): string;
  close(): Promise<void>;
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response>;
};

export function createProductizedShareServer(
  options: ProductizedShareServerOptions = {},
): ServerHandle {
  const store = options.store ?? new RelayStore();
  const runtimes = options.runtimes ?? new HostRuntimeRegistry();
  const adapterInventory = options.adapterInventory ?? new AdapterRegistry();
  const hostBootstrapSecret = options.hostBootstrapSecret
    ?? process.env.RALPHLOOP_HOST_BOOTSTRAP_SECRET
    ?? "ralphloop-local-bootstrap-secret";
  let server: Server | undefined;
  let inProcessUrl: string | undefined;

  return {
    async listen(port: number) {
      server = createServer((request, response) => {
        void handleRequest({
          request,
          response,
          store,
          runtimes,
          adapterInventory,
          tokenFactory: options.tokenFactory,
          hostBootstrapSecret,
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
        runtimes,
        adapterInventory,
        tokenFactory: options.tokenFactory,
        hostBootstrapSecret,
      });
    },
  };
}

async function dispatchInProcess(input: {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
  store: RelayStore;
  runtimes: HostRuntimeRegistry;
  adapterInventory: { detectAll(): Promise<AgentAdapterInfo[]> };
  tokenFactory?: () => string;
  hostBootstrapSecret?: string;
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
      runtimes: input.runtimes,
      adapterInventory: input.adapterInventory,
      tokenFactory: input.tokenFactory,
      hostBootstrapSecret: input.hostBootstrapSecret,
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
  store: RelayStore;
  runtimes: HostRuntimeRegistry;
  adapterInventory: { detectAll(): Promise<AgentAdapterInfo[]> };
  tokenFactory?: () => string;
  hostBootstrapSecret?: string;
}) {
  const url = new URL(input.request.url ?? "/", `http://${input.request.headers.host ?? "127.0.0.1"}`);

  if (input.request.method === "GET" && url.pathname === "/favicon.ico") {
    input.response.writeHead(204);
    input.response.end();
    return;
  }

  if (input.request.method === "GET" && url.pathname === "/") {
    sendRedirect(input.response, "/app/owner");
    return;
  }

  if (input.request.method === "GET" && url.pathname === "/app/owner") {
    sendHtml(input.response, 200, renderOwnerPage());
    return;
  }

  if (input.request.method === "GET" && url.pathname === "/v1/owner/hosts") {
    const result = listOwnerHostsV1({
      store: input.store,
      ownerId: url.searchParams.get("ownerId") ?? "",
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  if (input.request.method === "GET" && url.pathname === "/v1/owner/adapters") {
    const result = await listOwnerAdaptersV1({
      store: input.store,
      ownerId: url.searchParams.get("ownerId") ?? "",
      adapterInventory: input.adapterInventory,
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  if (input.request.method === "GET" && url.pathname === "/v1/owner/audit-logs") {
    const result = listOwnerAuditLogsV1({
      store: input.store,
      ownerId: url.searchParams.get("ownerId") ?? "",
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  if (input.request.method === "GET" && url.pathname === "/v1/owner/sessions") {
    const result = listOwnerSessionsV1({
      store: input.store,
      ownerId: url.searchParams.get("ownerId") ?? "",
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  if (input.request.method === "GET" && url.pathname === "/v1/owner/share-links") {
    const result = listOwnerShareLinksV1({
      store: input.store,
      ownerId: url.searchParams.get("ownerId") ?? "",
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  if (input.request.method === "GET" && url.pathname === "/v1/owner/tasks") {
    const result = listOwnerTasksV1({
      store: input.store,
      ownerId: url.searchParams.get("ownerId") ?? "",
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  if (input.request.method === "GET" && url.pathname === "/v1/owner/approvals") {
    const result = listOwnerApprovalRequestsV1({
      store: input.store,
      ownerId: url.searchParams.get("ownerId") ?? "",
      status: approvalStatusField(url.searchParams.get("status")),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const appShareAssistantUiMatch = url.pathname.match(/^\/app\/share\/([^/]+)\/assistant-ui$/);
  if (input.request.method === "GET" && appShareAssistantUiMatch) {
    const token = decodeURIComponent(appShareAssistantUiMatch[1]);
    const result = getFriendSharePageV1({
      store: input.store,
      token,
    });
    if (!result.body.available) {
      sendHtml(input.response, 200, renderFriendUnavailablePage());
      return;
    }

    const sessionId = url.searchParams.get("sessionId") ?? "";
    const taskId = url.searchParams.get("taskId") ?? "";

    // D.5: classify the requested session up-front. The existing
    // client-side flow (`assistantUiClientScript.ts:failCurrentThread`)
    // already surfaces "当前会话已失效，请新建会话后重试。" when
    // `/v1/share/.../events` returns `events_unavailable`, so for `stale`
    // sessions we just let that flow run — but we attach a deterministic
    // hidden SSR marker so the same banner copy is present in the first-
    // paint HTML for crawlers / no-JS environments and for the D.5
    // contract test. We intentionally do NOT mutate `currentThreadId` or
    // the SSR events list, because doing so prevents the client-side
    // recovery (`markThreadEventsUnavailable`) from observing the dead
    // thread and flipping status to "failed".
    const STALE_AFTER_MS = 30 * 60 * 1000;
    const staleSession = sessionId
      ? input.store.findStaleSession({
        sessionId,
        taskId: taskId || undefined,
        staleAfterMs: STALE_AFTER_MS,
      })
      : undefined;
    const isStale = staleSession?.kind === "stale";

    const eventResult = sessionId
      ? getFriendTaskEventsV1({
        store: input.store,
        token,
        sessionId,
        taskId,
        format: "ag-ui",
      })
      : undefined;
    const events = eventResult?.status === 200 && Array.isArray(eventResult.body.events)
      ? eventResult.body.events
      : [];
    const currentThreadId = sessionId || "assistant-ui-preview";
    const shellHtml = renderAssistantUiReactShellInSubprocess({
      token,
      currentThreadId,
      threadTitle: result.body.agent.name,
      taskId,
      events,
    });

    const staleBanner = isStale
      ? '<noscript class="assistant-ui-stale-banner" data-ralphloop-stale-session="true">当前会话已失效，请新建会话后重试。</noscript>'
      : "";

    sendHtml(input.response, result.status, renderAssistantUiSharePage({
      token,
      agentName: result.body.agent.name,
      currentThreadId,
      taskId,
      shellHtml: `${staleBanner}${shellHtml}`,
    }));
    return;
  }

  const appShareV2AssetMatch = url.pathname.match(/^\/app\/share\/([^/]+)\/v2\/assets\/(.+)$/);
  if (input.request.method === "GET" && appShareV2AssetMatch) {
    const token = decodeURIComponent(appShareV2AssetMatch[1]);
    const result = getFriendSharePageV1({
      store: input.store,
      token,
    });
    if (!result.body.available) {
      sendHtml(input.response, 200, renderFriendUnavailablePage());
      return;
    }
    serveReactV2Asset({
      response: input.response,
      assetPath: appShareV2AssetMatch[2],
    });
    return;
  }

  const appShareV2Match = url.pathname.match(/^\/app\/share\/([^/]+)\/v2$/);
  if (input.request.method === "GET" && appShareV2Match) {
    const token = decodeURIComponent(appShareV2Match[1]);
    const result = getFriendSharePageV1({
      store: input.store,
      token,
    });
    if (!result.body.available) {
      sendHtml(input.response, 200, renderFriendUnavailablePage());
      return;
    }

    const sessionId = url.searchParams.get("sessionId") ?? "";
    const taskId = url.searchParams.get("taskId") ?? "";
    const eventResult = sessionId
      ? getFriendTaskEventsV1({
        store: input.store,
        token,
        sessionId,
        taskId,
        format: "ag-ui",
      })
      : undefined;
    const events = eventResult?.status === 200 && Array.isArray(eventResult.body.events)
      ? eventResult.body.events
      : [];
    sendHtml(input.response, result.status, renderReactV2SharePage({
      token,
      agentName: result.body.agent.name,
      sessionId,
      taskId,
      events,
    }));
    return;
  }

  const appShareClassicMatch = url.pathname.match(/^\/app\/share\/([^/]+)\/classic$/);
  if (input.request.method === "GET" && appShareClassicMatch) {
    const token = decodeURIComponent(appShareClassicMatch[1]);
    const result = getFriendSharePageV1({
      store: input.store,
      token,
    });
    if (!result.body.available) {
      sendHtml(input.response, 200, renderFriendUnavailablePage());
      return;
    }

    sendHtml(input.response, result.status, renderFriendPage({
      token,
      agentName: result.body.agent.name,
      previewMode: result.body.agent.previewMode,
    }));
    return;
  }

  const appShareMatch = url.pathname.match(/^\/app\/share\/([^/]+)$/);
  if (input.request.method === "GET" && appShareMatch) {
    const token = decodeURIComponent(appShareMatch[1]);
    sendRedirect(input.response, `/app/share/${encodeURIComponent(token)}/assistant-ui${url.search}`);
    return;
  }

  if (input.request.method === "POST" && url.pathname === "/v1/hosts/register") {
    const body = await readJsonBody(input.request);
    const providedSecret = stringField(input.request.headers["x-ralphloop-bootstrap-secret"]);
    if (!providedSecret) {
      input.store.appendAuditLog({
        ownerId: stringField(body.ownerId, "unknown-owner"),
        actorType: "host",
        eventType: "host.auth_failed",
        summary: "host register missing bootstrap secret",
        metadata: {
          hostId: optionalStringField(body.hostId),
          reason: "missing_bootstrap_secret",
        },
      });
      sendJson(input.response, 401, { error: "host_auth_required" });
      return;
    }
    if (providedSecret !== input.hostBootstrapSecret) {
      input.store.appendAuditLog({
        ownerId: stringField(body.ownerId, "unknown-owner"),
        actorType: "host",
        eventType: "host.auth_failed",
        summary: "host register bootstrap secret invalid",
        metadata: {
          hostId: optionalStringField(body.hostId),
          reason: "invalid_bootstrap_secret",
        },
      });
      sendJson(input.response, 403, { error: "host_auth_invalid" });
      return;
    }

    const deviceKey = generateDeviceKey();
    const result = registerHost({
      store: input.store,
      ownerId: stringField(body.ownerId),
      hostId: optionalStringField(body.hostId),
      deviceName: stringField(body.deviceName),
      hostVersion: stringField(body.hostVersion),
      supportedAdapters: stringArrayField(body.supportedAdapters),
      capabilities: stringArrayField(body.capabilities),
      deviceKeyHash: hashDeviceKey(deviceKey),
    });
    sendJson(input.response, result.status, { ...result.body, deviceKey });
    return;
  }

  const heartbeatMatch = url.pathname.match(/^\/v1\/hosts\/([^/]+)\/heartbeat$/);
  if (input.request.method === "POST" && heartbeatMatch) {
    const body = await readJsonBody(input.request);
    const hostId = decodeURIComponent(heartbeatMatch[1]);
    const auth = authenticateHostRequest({
      store: input.store,
      hostId,
      providedKey: stringField(input.request.headers["x-ralphloop-device-key"]),
      action: "heartbeat",
    });
    if (!auth.ok) {
      sendJson(input.response, auth.status, auth.body);
      return;
    }
    const result = recordHostHeartbeat({
      store: input.store,
      hostId,
      supportedAdapters: stringArrayField(body.supportedAdapters),
      capabilities: stringArrayField(body.capabilities),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const hostCommandsMatch = url.pathname.match(/^\/v1\/hosts\/([^/]+)\/commands$/);
  if (input.request.method === "GET" && hostCommandsMatch) {
    const hostId = decodeURIComponent(hostCommandsMatch[1]);
    const auth = authenticateHostRequest({
      store: input.store,
      hostId,
      providedKey: stringField(input.request.headers["x-ralphloop-device-key"]),
      action: "commands",
    });
    if (!auth.ok) {
      sendJson(input.response, auth.status, auth.body);
      return;
    }
    const result = claimHostCommandV1({
      store: input.store,
      hostId,
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const hostEventsMatch = url.pathname.match(/^\/v1\/hosts\/([^/]+)\/events$/);
  if (input.request.method === "POST" && hostEventsMatch) {
    const body = await readJsonBody(input.request);
    const hostId = decodeURIComponent(hostEventsMatch[1]);
    const auth = authenticateHostRequest({
      store: input.store,
      hostId,
      providedKey: stringField(input.request.headers["x-ralphloop-device-key"]),
      action: "events",
    });
    if (!auth.ok) {
      sendJson(input.response, auth.status, auth.body);
      return;
    }
    const result = recordHostCommandEventsV1({
      store: input.store,
      hostId,
      commandId: stringField(body.commandId),
      sessionId: stringField(body.sessionId),
      taskId: stringField(body.taskId),
      runtimeId: optionalStringField(body.runtimeId),
      events: runtimeEventsField(body.events),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  if (input.request.method === "POST" && url.pathname === "/v1/owner/share-links") {
    const body = await readJsonBody(input.request);
    const result = createOwnerShareLinkV1({
      store: input.store,
      ownerId: stringField(body.ownerId),
      hostId: stringField(body.hostId),
      name: stringField(body.name),
      baseUrl: originFor(input.request),
      tokenFactory: input.tokenFactory,
      policy: objectField(body.policy),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const updateShareLinkMatch = url.pathname.match(/^\/v1\/owner\/share-links\/([^/]+)$/);
  if (input.request.method === "PATCH" && updateShareLinkMatch) {
    const body = await readJsonBody(input.request);
    const result = updateOwnerShareLinkV1({
      store: input.store,
      ownerId: stringField(body.ownerId),
      shareLinkId: decodeURIComponent(updateShareLinkMatch[1]),
      name: optionalStringField(body.name),
      expiresAt: optionalStringField(body.expiresAt),
      policy: objectField(body.policy),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const pauseShareLinkMatch = url.pathname.match(/^\/v1\/owner\/share-links\/([^/]+)\/pause$/);
  if (input.request.method === "POST" && pauseShareLinkMatch) {
    const body = await readJsonBody(input.request);
    const result = pauseOwnerShareLinkByIdV1({
      store: input.store,
      ownerId: stringField(body.ownerId),
      shareLinkId: decodeURIComponent(pauseShareLinkMatch[1]),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const resumeShareLinkMatch = url.pathname.match(/^\/v1\/owner\/share-links\/([^/]+)\/resume$/);
  if (input.request.method === "POST" && resumeShareLinkMatch) {
    const body = await readJsonBody(input.request);
    const result = resumeOwnerShareLinkByIdV1({
      store: input.store,
      ownerId: stringField(body.ownerId),
      shareLinkId: decodeURIComponent(resumeShareLinkMatch[1]),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const revokeShareLinkMatch = url.pathname.match(/^\/v1\/owner\/share-links\/([^/]+)\/revoke$/);
  if (input.request.method === "POST" && revokeShareLinkMatch) {
    const body = await readJsonBody(input.request);
    const result = await revokeOwnerShareLinkByIdV1({
      store: input.store,
      runtimes: input.runtimes,
      ownerId: stringField(body.ownerId),
      shareLinkId: decodeURIComponent(revokeShareLinkMatch[1]),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const cancelSessionMatch = url.pathname.match(/^\/v1\/owner\/sessions\/([^/]+)\/cancel$/);
  if (input.request.method === "POST" && cancelSessionMatch) {
    const body = await readJsonBody(input.request);
    const result = await cancelOwnerSessionV1({
      store: input.store,
      runtimes: input.runtimes,
      ownerId: stringField(body.ownerId),
      sessionId: decodeURIComponent(cancelSessionMatch[1]),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const ownerApprovalMatch = url.pathname.match(/^\/v1\/owner\/approvals\/([^/]+)\/(approve|deny)$/);
  if (input.request.method === "POST" && ownerApprovalMatch) {
    const body = await readJsonBody(input.request);
    const result = resolveOwnerApprovalRequestV1({
      store: input.store,
      ownerId: stringField(body.ownerId),
      requestId: decodeURIComponent(ownerApprovalMatch[1]),
      status: ownerApprovalMatch[2] === "approve" ? "approved" : "denied",
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const friendConfirmationsMatch = url.pathname.match(/^\/v1\/share\/([^/]+)\/confirmations$/);
  if (input.request.method === "GET" && friendConfirmationsMatch) {
    const result = listFriendConfirmationsV1({
      store: input.store,
      token: decodeURIComponent(friendConfirmationsMatch[1]),
      sessionId: url.searchParams.get("sessionId") ?? "",
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const friendConfirmationResolveMatch = url.pathname.match(/^\/v1\/share\/([^/]+)\/confirmations\/([^/]+)\/(approve|deny)$/);
  if (input.request.method === "POST" && friendConfirmationResolveMatch) {
    const body = await readJsonBody(input.request);
    const result = resolveFriendConfirmationV1({
      store: input.store,
      token: decodeURIComponent(friendConfirmationResolveMatch[1]),
      requestId: decodeURIComponent(friendConfirmationResolveMatch[2]),
      sessionId: stringField(body.sessionId),
      status: friendConfirmationResolveMatch[3] === "approve" ? "approved" : "denied",
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const friendSessionMatch = url.pathname.match(/^\/v1\/share\/([^/]+)\/sessions$/);
  if (input.request.method === "POST" && friendSessionMatch) {
    const body = await readJsonBody(input.request);
    const result = createFriendSessionV1({
      store: input.store,
      token: decodeURIComponent(friendSessionMatch[1]),
      displayName: optionalStringField(body.displayName),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const friendSessionCancelMatch = url.pathname.match(/^\/v1\/share\/([^/]+)\/sessions\/([^/]+)\/cancel$/);
  if (input.request.method === "POST" && friendSessionCancelMatch) {
    const result = await cancelFriendSessionV1({
      store: input.store,
      runtimes: input.runtimes,
      token: decodeURIComponent(friendSessionCancelMatch[1]),
      sessionId: decodeURIComponent(friendSessionCancelMatch[2]),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const friendAuthStartMatch = url.pathname.match(/^\/v1\/share\/([^/]+)\/auth\/([^/]+)\/start$/);
  if (input.request.method === "POST" && friendAuthStartMatch) {
    const body = await readJsonBody(input.request);
    const result = startFriendAuthV1({
      store: input.store,
      token: decodeURIComponent(friendAuthStartMatch[1]),
      provider: decodeURIComponent(friendAuthStartMatch[2]),
      sessionId: stringField(body.sessionId),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const eventsMatch = url.pathname.match(/^\/v1\/share\/([^/]+)\/events$/);
  if (input.request.method === "GET" && eventsMatch) {
    const result = getFriendTaskEventsV1({
      store: input.store,
      token: decodeURIComponent(eventsMatch[1]),
      sessionId: url.searchParams.get("sessionId") ?? "",
      taskId: url.searchParams.get("taskId") ?? undefined,
      format: url.searchParams.get("format") === "ag-ui" ? "ag-ui" : "runtime",
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const previewMatch = url.pathname.match(/^\/v1\/share\/([^/]+)\/preview$/);
  if (input.request.method === "GET" && previewMatch) {
    const result = getFriendPreviewV1({
      store: input.store,
      token: decodeURIComponent(previewMatch[1]),
      sessionId: url.searchParams.get("sessionId") ?? "",
      taskId: url.searchParams.get("taskId") ?? "",
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const shareMatch = url.pathname.match(/^\/v1\/share\/([^/]+)$/);
  if (input.request.method === "GET" && shareMatch) {
    const result = getFriendSharePageV1({
      store: input.store,
      token: decodeURIComponent(shareMatch[1]),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  const taskMatch = url.pathname.match(/^\/v1\/share\/([^/]+)\/tasks$/);
  if (input.request.method === "POST" && taskMatch) {
    const body = await readJsonBody(input.request);
    const result = await submitFriendTaskV1({
      store: input.store,
      runtimes: input.runtimes,
      token: decodeURIComponent(taskMatch[1]),
      sessionId: optionalStringField(body.sessionId),
      prompt: stringField(body.prompt),
      estimatedTaskBudget: numberField(body.estimatedTaskBudget),
    });
    sendJson(input.response, result.status, result.body);
    return;
  }

  sendJson(input.response, 404, { error: "not_found" });
}

function renderOwnerPage(): string {
  return htmlPage("Ralphloop Owner", `
	    <main class="app-shell owner-shell">
	      <header class="topbar">
	        <div>
	          <p class="eyebrow">Ralphloop</p>
	          <h1>分享你的桌面 Agent</h1>
	        </div>
	        <span class="status-pill" data-testid="owner-host-connection-pill">Host 在线</span>
	      </header>

      <section class="workspace-grid">
        <section class="surface runtime-surface" aria-label="Host">
          <div class="section-heading">
            <h2>运行时</h2>
            <span id="host-id">host-1</span>
          </div>
	          <dl class="runtime-list">
	            <div>
	              <dt>设备</dt>
	              <dd id="host-device" data-testid="owner-host-device">正在读取 Host</dd>
	            </div>
	            <div>
	              <dt>状态</dt>
	              <dd id="host-status" data-testid="owner-host-status">检测中</dd>
	            </div>
	            <div>
	              <dt>重连</dt>
	              <dd id="host-reconnect" data-testid="owner-host-reconnect">检测中</dd>
	            </div>
	            <div>
	              <dt>离线原因</dt>
	              <dd id="host-offline-reason" data-testid="owner-host-offline-reason">-</dd>
	            </div>
	            <div>
	              <dt>认证</dt>
	              <dd id="host-auth" data-testid="owner-host-auth">设备密钥</dd>
	            </div>
	            <div>
	              <dt>上次心跳</dt>
	              <dd id="host-last-seen" data-testid="owner-host-last-seen">-</dd>
	            </div>
	            <div>
	              <dt>权限</dt>
	              <dd>使用者身份</dd>
	            </div>
	          </dl>
          <div class="adapter-list" id="adapter-list" role="radiogroup" aria-label="Agent 框架"></div>
        </section>

        <section class="surface action-surface" aria-label="Share">
          <div class="section-heading">
            <h2>分享</h2>
            <span>私密链接</span>
	          </div>
	          <button id="create-share-link" type="button">生成分享链接</button>
	          <p class="share-output"><a id="share-link"></a></p>
	          <p id="control-status" class="muted-label" data-testid="owner-kill-result"></p>
	          <div class="owner-controls" id="owner-controls">
	            <button id="revoke-share-link" class="danger-button" type="button" disabled>撤销链接</button>
	          </div>
	        </section>
	      </section>

      <section class="surface audit-surface" aria-label="审计日志">
        <div class="section-heading">
          <h2>审计日志</h2>
          <button id="refresh-audit-log" class="secondary-button" type="button">刷新</button>
        </div>
        <ol id="audit-log" class="audit-log"></ol>
      </section>

      <section class="surface history-surface" aria-label="分享链接列表">
        <div class="section-heading">
          <h2>分享链接</h2>
          <button id="refresh-share-links" class="secondary-button" type="button">刷新</button>
        </div>
        <ol id="share-link-list" class="owner-list"></ol>
      </section>

      <section class="surface history-surface" aria-label="当前会话">
        <div class="section-heading">
          <h2>当前会话</h2>
          <button id="refresh-sessions" class="secondary-button" type="button">刷新</button>
        </div>
        <ol id="session-list" class="owner-list"></ol>
      </section>

      <section class="surface history-surface" aria-label="任务历史">
        <div class="section-heading">
          <h2>任务历史</h2>
          <button id="refresh-task-history" class="secondary-button" type="button">刷新</button>
        </div>
        <ol id="task-history" class="owner-list"></ol>
      </section>

      <section class="surface approval-surface" aria-label="审批队列">
        <div class="section-heading">
          <h2>审批队列</h2>
          <button id="refresh-approvals" class="secondary-button" type="button">刷新</button>
        </div>
        <ol id="approval-queue" class="approval-list"></ol>
      </section>
    </main>
    <script>
      const ownerId = "owner-1";
      let selectedHostId = "host-1";
      let selectedAdapterId = "";
      let availableAdapterIds = [];
      let currentShareLinkId = "";
      const shareUrlsById = new Map();
      const createButton = document.getElementById("create-share-link");
      const revokeButton = document.getElementById("revoke-share-link");
      const refreshAuditButton = document.getElementById("refresh-audit-log");
      const shareLink = document.getElementById("share-link");
	      const hostId = document.getElementById("host-id");
	      const hostDevice = document.getElementById("host-device");
	      const hostStatus = document.getElementById("host-status");
	      const hostReconnect = document.getElementById("host-reconnect");
	      const hostOfflineReason = document.getElementById("host-offline-reason");
	      const hostAuth = document.getElementById("host-auth");
	      const hostLastSeen = document.getElementById("host-last-seen");
	      const adapterList = document.getElementById("adapter-list");
	      const auditLog = document.getElementById("audit-log");
	      const controlStatus = document.getElementById("control-status");
      const approvalQueue = document.getElementById("approval-queue");
      const refreshApprovalsButton = document.getElementById("refresh-approvals");
      const shareLinkList = document.getElementById("share-link-list");
      const refreshShareLinksButton = document.getElementById("refresh-share-links");
      const sessionList = document.getElementById("session-list");
      const refreshSessionsButton = document.getElementById("refresh-sessions");
      const taskHistory = document.getElementById("task-history");
      const refreshTaskHistoryButton = document.getElementById("refresh-task-history");
      const terminalSessionStatuses = new Set(["completed", "failed", "cancelled"]);

      function escapeText(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function renderAdapters(adapters) {
        availableAdapterIds = adapters;
        selectedAdapterId = adapters[0] ?? "";
        adapterList.innerHTML = adapters.map((adapterId, index) => {
          const checked = index === 0 ? " checked" : "";
          const label = escapeText(adapterId);
          return '<label class="adapter-choice"><input type="radio" name="adapterId" value="' + label + '"' + checked + '> <span>' + label + '</span></label>';
        }).join("");
        createButton.disabled = adapters.length === 0;
      }

      adapterList?.addEventListener("change", (event) => {
        const target = event.target;
        if (target?.name === "adapterId") {
          selectedAdapterId = target.value;
        }
      });

	      async function loadHosts() {
	        const response = await fetch("/v1/owner/hosts?ownerId=" + encodeURIComponent(ownerId));
	        const body = await response.json();
	        const host = body.hosts?.[0];
	        if (!host) {
	          hostStatus.textContent = "未连接";
	          hostReconnect.textContent = "-";
	          hostOfflineReason.textContent = "-";
	          hostLastSeen.textContent = "-";
	          createButton.disabled = true;
	          return;
	        }

	        selectedHostId = host.id;
	        hostId.textContent = host.id;
	        hostDevice.textContent = host.deviceName;
	        hostAuth.textContent = "设备密钥";
	        hostLastSeen.textContent = host.lastSeenAt ? new Date(host.lastSeenAt).toLocaleString() : "-";
	        if (host.status === "online") {
	          hostStatus.textContent = "在线";
	          hostReconnect.textContent = "已连接";
	          hostOfflineReason.textContent = "-";
	        } else if (host.status === "offline") {
	          hostStatus.textContent = "离线";
	          hostReconnect.textContent = "等待重连";
	          hostOfflineReason.textContent = host.offlineReason ? String(host.offlineReason) : "-";
	        } else {
	          hostStatus.textContent = "不可用";
	          hostReconnect.textContent = "-";
	          hostOfflineReason.textContent = host.offlineReason ? String(host.offlineReason) : "-";
	        }
	        renderAdapters(host.supportedAdapters ?? []);
	      }

      async function refreshAuditLog() {
        const response = await fetch("/v1/owner/audit-logs?ownerId=" + encodeURIComponent(ownerId));
        const body = await response.json();
        auditLog.innerHTML = (body.auditLogs ?? []).map((entry) => {
          return '<li><strong>' + escapeText(entry.eventType) + '</strong><span>' + escapeText(entry.summary) + '</span></li>';
        }).join("");
      }

      async function refreshApprovals() {
        const response = await fetch("/v1/owner/approvals?ownerId=" + encodeURIComponent(ownerId) + "&status=pending");
        const body = await response.json();
        approvalQueue.innerHTML = (body.approvalRequests ?? []).map((request) => {
          const actions = request.requiredDecision === "owner_approve"
            ? '<div class="approval-actions"><button class="approve-owner-approval secondary-button" data-request-id="' + escapeText(request.id) + '" type="button">批准</button><button class="deny-owner-approval danger-button" data-request-id="' + escapeText(request.id) + '" type="button">拒绝</button></div>'
            : '<span class="muted-label">等待朋友确认</span>';
          return '<li><strong>' + escapeText(request.actionType) + '</strong><span>' + escapeText(request.summary) + '</span>' + actions + '</li>';
        }).join("");
      }

      function renderShareLinkAdapterChoices(link) {
        const selectedAdapters = link.allowedAdapterIds ?? [];
        const adapters = availableAdapterIds.length > 0 ? availableAdapterIds : selectedAdapters;
        return adapters.map((adapterId) => {
          const label = escapeText(adapterId);
          const checked = selectedAdapters.includes(adapterId) ? " checked" : "";
          return '<label class="share-link-adapter-choice"><input type="checkbox" name="allowedAdapterIds" value="' + label + '"' + checked + '> <span>' + label + '</span></label>';
        }).join("");
      }

      function assistantUiShareUrl(token) {
        return new URL("/app/share/" + encodeURIComponent(token) + "/assistant-ui", window.location.origin).toString();
      }

      async function refreshShareLinks() {
        const response = await fetch("/v1/owner/share-links?ownerId=" + encodeURIComponent(ownerId));
        const body = await response.json();
        shareLinkList.innerHTML = (body.shareLinks ?? []).map((link) => {
          const adapter = (link.allowedAdapterIds ?? []).join(", ");
          const usage = String(link.budgetUsed ?? 0) + "/" + String(link.maxTotalBudget ?? 0);
          const lifecycleAction = link.status === "active"
            ? '<button class="pause-share-link secondary-button" data-share-link-id="' + escapeText(link.id) + '" type="button">暂停</button>'
            : link.status === "paused"
              ? '<button class="resume-share-link secondary-button" data-share-link-id="' + escapeText(link.id) + '" type="button">启用</button>'
              : '<span class="muted-label">不可恢复</span>';
          const revokeAction = link.status === "active" || link.status === "paused"
            ? '<button class="revoke-listed-share-link danger-button secondary-button" data-share-link-id="' + escapeText(link.id) + '" type="button">撤销</button>'
            : "";
          const editForm = link.status === "active" || link.status === "paused"
            ? '<form class="share-link-edit-form" data-share-link-id="' + escapeText(link.id) + '"><label class="share-link-name-field"><span>名称</span><input class="share-link-name-input" name="name" value="' + escapeText(link.name) + '" maxlength="80"></label><fieldset class="share-link-adapter-list"><legend>允许框架</legend>' + renderShareLinkAdapterChoices(link) + '</fieldset><button class="save-share-link secondary-button" type="submit">保存</button></form>'
            : "";
          const openUrl = link.url || shareUrlsById.get(link.id) || "";
          const openLink = openUrl && (link.status === "active" || link.status === "paused")
            ? '<a class="secondary-button assistant-ui-share-open" href="' + escapeText(openUrl) + '">打开对话页</a>'
            : '<span class="muted-label">链接仅创建时显示</span>';
          return '<li class="share-link-list-item"><div class="share-link-summary"><strong>' + escapeText(link.name) + '</strong><span>' + escapeText(link.status) + ' · ' + escapeText(adapter) + ' · 用量 ' + escapeText(usage) + '</span></div>' + editForm + '<div class="approval-actions">' + openLink + lifecycleAction + revokeAction + '</div></li>';
        }).join("");
      }

      async function updateShareLinkFromForm(form) {
        const shareLinkId = form?.dataset?.shareLinkId ?? "";
        if (!shareLinkId) {
          return;
        }
        const data = new FormData(form);
        const name = String(data.get("name") ?? "").trim();
        const allowedAdapterIds = data.getAll("allowedAdapterIds").map((value) => String(value)).filter(Boolean);
        if (!name) {
          controlStatus.textContent = "请输入链接名称";
          return;
        }
        if (allowedAdapterIds.length === 0) {
          controlStatus.textContent = "至少选择一个 Agent 框架";
          return;
        }
        const response = await fetch("/v1/owner/share-links/" + encodeURIComponent(shareLinkId), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ownerId,
            name,
            policy: { allowedAdapterIds },
          }),
        });
        const body = await response.json();
        controlStatus.textContent = response.ok ? "已保存链接配置" : "保存失败：" + escapeText(body?.error ?? "unknown_error");
        await refreshShareLinks();
        await refreshAuditLog();
      }

      async function updateShareLinkLifecycle(shareLinkId, action) {
        if (!shareLinkId) {
          return;
        }
        const endpoint = action === "pause"
          ? "/v1/owner/share-links/" + encodeURIComponent(shareLinkId) + "/pause"
          : "/v1/owner/share-links/" + encodeURIComponent(shareLinkId) + "/resume";
        await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ownerId }),
        });
        await refreshShareLinks();
        await refreshAuditLog();
      }

      async function revokeShareLink(shareLinkId) {
        if (!shareLinkId) {
          return;
        }
        const response = await fetch("/v1/owner/share-links/" + encodeURIComponent(shareLinkId) + "/revoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ownerId }),
        });
        const body = await response.json();
        controlStatus.textContent = response.ok ? "已请求撤销链接" : "撤销失败：" + escapeText(body?.error ?? "unknown_error");
        if (shareLinkId === currentShareLinkId) {
          revokeButton.disabled = response.ok;
          if (response.ok) {
            shareLink.removeAttribute("href");
            shareLink.textContent = "链接已撤销";
          }
        }
        await refreshAuditLog();
        await refreshShareLinks();
        await refreshSessions();
        await refreshTaskHistory();
      }

      async function refreshSessions() {
        const response = await fetch("/v1/owner/sessions?ownerId=" + encodeURIComponent(ownerId));
        const body = await response.json();
        sessionList.innerHTML = (body.sessions ?? []).map((session) => {
          const action = terminalSessionStatuses.has(session.status)
            ? '<span class="muted-label">已结束</span>'
            : '<button class="cancel-owner-session danger-button" data-session-id="' + escapeText(session.id) + '" type="button">终止</button>';
          return '<li><strong>' + escapeText(session.status) + '</strong><span>' + escapeText(session.adapterId) + ' · ' + escapeText(session.friendActorId) + '</span><div class="approval-actions">' + action + '</div></li>';
        }).join("");
      }

	      async function cancelOwnerSession(sessionId) {
	        if (!sessionId) {
	          return;
	        }
	        const response = await fetch("/v1/owner/sessions/" + encodeURIComponent(sessionId) + "/cancel", {
	          method: "POST",
	          headers: { "content-type": "application/json" },
	          body: JSON.stringify({ ownerId }),
	        });
	        const body = await response.json();
	        controlStatus.textContent = response.ok ? "已请求终止会话" : "终止失败：" + escapeText(body?.error ?? "unknown_error");
	        await refreshSessions();
	        await refreshTaskHistory();
	        await refreshAuditLog();
	      }

      async function refreshTaskHistory() {
        const response = await fetch("/v1/owner/tasks?ownerId=" + encodeURIComponent(ownerId));
        const body = await response.json();
        taskHistory.innerHTML = (body.tasks ?? []).map((task) => {
          const failure = task.failureReason ? ' · ' + escapeText(task.failureReason) : "";
          return '<li><strong>' + escapeText(task.status) + '</strong><span>' + escapeText(task.prompt) + ' · ' + escapeText(task.adapterId) + ' · ' + escapeText(task.friendActorId) + failure + '</span></li>';
        }).join("");
      }

      async function resolveOwnerApproval(requestId, action) {
        await fetch("/v1/owner/approvals/" + encodeURIComponent(requestId) + "/" + action, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ownerId }),
        });
        await refreshApprovals();
        await refreshAuditLog();
      }

      createButton?.addEventListener("click", async () => {
        createButton.setAttribute("disabled", "true");
        controlStatus.textContent = "";
        try {
          const response = await fetch("/v1/owner/share-links", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ownerId,
              hostId: selectedHostId,
              name: "Ralphloop Agent",
              policy: selectedAdapterId ? { allowedAdapterIds: [selectedAdapterId] } : undefined,
            }),
          });
          const body = await response.json();
          if (!response.ok || !body.shareLink) {
            controlStatus.textContent = "创建失败：" + escapeText(body?.error ?? "unknown_error");
            await loadHosts();
            await refreshAuditLog();
            return;
          }

          currentShareLinkId = body.shareLink.id;
          const url = body.shareLink.url || assistantUiShareUrl(body.shareLink.token);
          shareUrlsById.set(body.shareLink.id, url);
          shareLink.href = url;
          shareLink.textContent = url;
          revokeButton.disabled = false;
          await refreshAuditLog();
          await refreshShareLinks();
        } catch (error) {
          controlStatus.textContent = "创建失败：" + escapeText(error instanceof Error ? error.message : "network_error");
        } finally {
          createButton.removeAttribute("disabled");
        }
      });

	      revokeButton?.addEventListener("click", async () => {
	        if (!currentShareLinkId) {
	          return;
	        }
	        revokeButton.setAttribute("disabled", "true");
	        await revokeShareLink(currentShareLinkId);
	      });

      refreshAuditButton?.addEventListener("click", () => {
        void refreshAuditLog();
      });

      refreshShareLinksButton?.addEventListener("click", () => {
        void refreshShareLinks();
      });

      refreshSessionsButton?.addEventListener("click", () => {
        void refreshSessions();
      });

      refreshTaskHistoryButton?.addEventListener("click", () => {
        void refreshTaskHistory();
      });

      refreshApprovalsButton?.addEventListener("click", () => {
        void refreshApprovals();
      });

      shareLinkList?.addEventListener("click", (event) => {
        const target = event.target;
        if (target?.classList?.contains("pause-share-link")) {
          void updateShareLinkLifecycle(target.dataset.shareLinkId, "pause");
        }
        if (target?.classList?.contains("resume-share-link")) {
          void updateShareLinkLifecycle(target.dataset.shareLinkId, "resume");
        }
        if (target?.classList?.contains("revoke-listed-share-link")) {
          void revokeShareLink(target.dataset.shareLinkId);
        }
      });

      shareLinkList?.addEventListener("submit", (event) => {
        const target = event.target;
        if (target?.classList?.contains("share-link-edit-form")) {
          event.preventDefault();
          void updateShareLinkFromForm(target);
        }
      });

      sessionList?.addEventListener("click", (event) => {
        const target = event.target;
        if (target?.classList?.contains("cancel-owner-session")) {
          void cancelOwnerSession(target.dataset.sessionId);
        }
      });

      approvalQueue?.addEventListener("click", (event) => {
        const target = event.target;
        if (target?.classList?.contains("approve-owner-approval")) {
          void resolveOwnerApproval(target.dataset.requestId, "approve");
        }
        if (target?.classList?.contains("deny-owner-approval")) {
          void resolveOwnerApproval(target.dataset.requestId, "deny");
        }
      });

      async function bootstrapOwnerPage() {
        await loadHosts();
        await Promise.all([
          refreshAuditLog(),
          refreshShareLinks(),
          refreshSessions(),
          refreshTaskHistory(),
          refreshApprovals(),
        ]);
      }

      void bootstrapOwnerPage();
    </script>
  `);
}

function renderFriendPage(input: {
  token: string;
  agentName: string;
  previewMode: string;
}): string {
  const sessionEndpoint = JSON.stringify(`/v1/share/${encodeURIComponent(input.token)}/sessions`);
  const taskEndpoint = JSON.stringify(`/v1/share/${encodeURIComponent(input.token)}/tasks`);
  const eventsEndpoint = JSON.stringify(`/v1/share/${encodeURIComponent(input.token)}/events`);
  const previewEndpoint = JSON.stringify(`/v1/share/${encodeURIComponent(input.token)}/preview`);
  const confirmationsEndpoint = JSON.stringify(`/v1/share/${encodeURIComponent(input.token)}/confirmations`);
  const previewLabel = input.previewMode === "interactive" ? "交互预览" : "只读预览";
  return htmlPage("Ralphloop Share", `
    <main class="app-shell friend-chat-shell" data-testid="friend-chat-shell">
      <aside class="surface friend-session-sidebar" aria-label="会话" data-testid="friend-session-sidebar">
        <div>
          <p class="eyebrow">Ralphloop</p>
          <h1>${escapeHtml(input.agentName)}</h1>
        </div>
        <button id="new-session" class="secondary-button new-session-button" type="button" data-testid="friend-new-session">新会话</button>
        <ol id="session-list" class="session-list" aria-label="会话列表">
          <li class="session-item-placeholder" data-testid="friend-session-item">准备会话</li>
        </ol>
      </aside>

      <section class="friend-chat-main" aria-label="Agent Chat">
        <header class="friend-chat-topbar">
          <div>
            <p class="eyebrow">朋友链接</p>
            <h2>Agent Chat</h2>
          </div>
          <div class="status-cluster">
            <span id="chat-status" class="status-pill">准备连接</span>
            <a id="friend-assistant-ui-link" class="secondary-button" href="/app/share/${encodeURIComponent(input.token)}/assistant-ui" data-testid="friend-assistant-ui-link">新版对话</a>
            <button id="preview-toggle" class="secondary-button" type="button" data-testid="friend-preview-toggle">桌面预览</button>
          </div>
        </header>

        <section id="chat-thread" class="chat-thread" aria-live="polite" aria-label="对话" data-testid="friend-chat-thread">
          <article class="chat-message assistant-message" data-testid="friend-chat-message">
            <span class="chat-message-role">Agent</span>
            <p class="chat-message-content">打开一个会话后，可以直接给 Agent 发送消息。</p>
          </article>
        </section>

        <form id="chat-form" class="chat-composer-dock" data-testid="friend-chat-composer">
          <label class="sr-only" for="chat-prompt">消息</label>
          <textarea id="chat-prompt" name="prompt" rows="3" aria-label="消息" placeholder="给 Agent 发送消息"></textarea>
          <div class="composer-actions">
            <span class="muted-label">多轮 Session 会保留在左侧列表</span>
            <div class="composer-button-row">
              <button id="chat-stop" class="secondary-button danger-outline" type="button" data-testid="friend-chat-stop" disabled>停止</button>
              <button id="chat-submit" type="submit" data-testid="friend-chat-submit">发送</button>
            </div>
          </div>
        </form>

        <form id="task-form" class="sr-only" aria-hidden="true">
          <label class="sr-only" for="task-prompt">任务</label>
          <textarea id="task-prompt" name="prompt"></textarea>
          <output id="task-status"></output>
          <output id="task-result"></output>
        </form>
      </section>

      <aside id="preview-drawer" class="surface preview-drawer" aria-hidden="true" aria-label="桌面预览" data-testid="friend-preview-drawer">
        <div class="section-heading">
          <h2>桌面预览</h2>
          <button id="preview-close" class="secondary-button" type="button" data-testid="friend-preview-close">关闭</button>
        </div>
        <div id="preview-frame" class="preview-frame">
          <span>${escapeHtml(previewLabel)}</span>
        </div>
      </aside>

      <template id="approval-card-template" data-testid="friend-approval-card"></template>
    </main>
    <script>
      const storageFallback = (() => {
        const values = new Map();
        return {
          getItem(key) {
            return values.has(key) ? values.get(key) : null;
          },
          setItem(key, value) {
            values.set(key, String(value));
          },
          removeItem(key) {
            values.delete(key);
          },
        };
      })();
      const browserStorage = typeof localStorage === "undefined" ? storageFallback : localStorage;
      const sessionStorageKey = "ralphloop:friend:sessions:" + ${JSON.stringify(input.token)};
      const activeSessionStorageKey = sessionStorageKey + ":active";
      let sessionStore = readSessionStore();
      let activeSessionId = browserStorage.getItem(activeSessionStorageKey) || "";
      let currentSessionId = activeSessionId;
      let currentTaskId = "";
      const chatForm = document.getElementById("chat-form");
      const chatPrompt = document.getElementById("chat-prompt");
      const chatStatus = document.getElementById("chat-status");
      const chatThread = document.getElementById("chat-thread");
      const chatSubmit = document.getElementById("chat-submit");
      const chatStop = document.getElementById("chat-stop");
      const sessionList = document.getElementById("session-list");
      const newSessionButton = document.getElementById("new-session");
      const previewToggle = document.getElementById("preview-toggle");
      const previewDrawer = document.getElementById("preview-drawer");
      const previewClose = document.getElementById("preview-close");
      const previewFrame = document.getElementById("preview-frame");
      const taskForm = document.getElementById("task-form");
      const taskPrompt = document.getElementById("task-prompt");
      const taskStatus = document.getElementById("task-status");
      const taskResult = document.getElementById("task-result");
      const previewLabel = ${JSON.stringify(previewLabel)};
      const terminalTaskEventTypes = new Set(["task.completed", "task.failed", "task.cancelled"]);
      const busySessionStatuses = new Set(["waiting", "starting", "running", "needs_input", "needs_user_auth", "needs_user_confirm", "needs_owner_approval"]);
      const taskPollTimers = new Map();
      let optimisticMessageCounter = 0;
      let sessionCreationPromise;
      const sessionSubmitQueues = new Map();

      function escapeText(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function readSessionStore() {
        try {
          const parsed = JSON.parse(browserStorage.getItem(sessionStorageKey) || "[]");
          if (!Array.isArray(parsed)) {
            return [];
          }
          return parsed.map((session) => ({
            ...session,
            messages: (Array.isArray(session.messages) ? session.messages : [])
              .filter((message) => !isHiddenConversationEventType(message.type)),
          }));
        } catch {
          return [];
        }
      }

      function saveSessionStore() {
        browserStorage.setItem(sessionStorageKey, JSON.stringify(sessionStore));
        if (activeSessionId) {
          browserStorage.setItem(activeSessionStorageKey, activeSessionId);
        }
      }

      function sessionById(sessionId) {
        return sessionStore.find((session) => session.id === sessionId);
      }

      function activeSession() {
        return sessionById(activeSessionId);
      }

      function upsertSession(session) {
        const existingIndex = sessionStore.findIndex((item) => item.id === session.id);
        if (existingIndex >= 0) {
          sessionStore[existingIndex] = { ...sessionStore[existingIndex], ...session };
          return sessionStore[existingIndex];
        }
        sessionStore.unshift({
          id: session.id,
          title: session.title || "新会话",
          status: session.status || "waiting",
          updatedAt: session.updatedAt || new Date().toISOString(),
          messages: session.messages || [],
          messageKeys: session.messageKeys || [],
          currentTaskId: session.currentTaskId || "",
        });
        return sessionStore[0];
      }

      function conversationEventKey(item, fallbackTaskId, index) {
        const taskId = String(item.taskId ?? fallbackTaskId ?? "");
        const content = String(item.text ?? item.message ?? item.actionSummary ?? item.scopeSummary ?? item.provider ?? "");
        return taskId + ":" + String(item.type ?? "event") + ":" + content + ":" + String(index);
      }

      function eventLabel(item) {
        switch (item.type) {
          case "user.task":
            return "你";
          case "task.output":
            return "Agent";
          case "task.completed":
            return "完成";
          case "task.failed":
            return "失败";
          case "task.cancelled":
            return "已取消";
          case "task.progress":
            return "进度";
          case "task.plan":
            return "计划";
          case "task.needs_user_auth":
            return "授权";
          case "task.needs_user_confirm":
          case "task.needs_owner_approval":
            return "确认";
          default:
            return "事件";
        }
      }

      function eventContent(item) {
        if (item.text || item.message || item.actionSummary || item.scopeSummary || item.provider) {
          return String(item.text ?? item.message ?? item.actionSummary ?? item.scopeSummary ?? item.provider);
        }
        if (item.type === "task.completed") {
          return "任务已完成";
        }
        if (item.type === "task.cancelled") {
          return "任务已取消";
        }
        return String(item.type ?? "event");
      }

      function isHiddenConversationEventType(type) {
        return type === "task.accepted";
      }

      function setStatus(value) {
        if (chatStatus) {
          chatStatus.textContent = value;
        }
        if (taskStatus) {
          taskStatus.textContent = value;
        }
        updateComposerState();
      }

      function activeSessionIsBusy() {
        const session = activeSession();
        return Boolean(session?.currentTaskId && busySessionStatuses.has(session.status));
      }

      function updateComposerState() {
        const busy = activeSessionIsBusy();
        if (chatStop) {
          chatStop.disabled = !busy;
          chatStop.setAttribute("aria-disabled", busy ? "false" : "true");
        }
        if (chatSubmit) {
          chatSubmit.textContent = busy ? "继续发送" : "发送";
        }
      }

      function messageKey(message) {
        return [
          message.taskId || "",
          message.type || "",
          message.role || "",
          message.content || "",
          message.requestId || "",
        ].join(":");
      }

      function appendChatMessage(message, sessionId = activeSessionId) {
        const session = sessionById(sessionId);
        if (!session) {
          return;
        }
        const key = message.key || messageKey(message);
        session.messageKeys = session.messageKeys || [];
        if (session.messageKeys.includes(key)) {
          return;
        }
        session.messageKeys.push(key);
        session.messages = session.messages || [];
        if (message.type === "task.output") {
          const existingOutput = session.messages.find((item) => {
            return item.type === "task.output" && String(item.taskId || "") === String(message.taskId || "");
          });
          if (existingOutput) {
            const nextContent = String(message.content || "");
            existingOutput.content = existingOutput.content
              ? existingOutput.content + "\\n" + nextContent
              : nextContent;
            session.updatedAt = new Date().toISOString();
            saveSessionStore();
            renderSessionList();
            if (session.id === activeSessionId) {
              renderChatThread();
            }
            return;
          }
        }
        session.messages.push({ ...message, key });
        session.updatedAt = new Date().toISOString();
        session.title = session.title && session.title !== "新会话"
          ? session.title
          : String(message.content || "新会话").slice(0, 32);
        saveSessionStore();
        renderSessionList();
        if (session.id === activeSessionId) {
          renderChatThread();
        }
      }

      function renderSessionList() {
        if (!sessionList) {
          return;
        }
        if (sessionStore.length === 0) {
          sessionList.innerHTML = '<li class="session-empty" data-testid="friend-session-item">暂无会话</li>';
          return;
        }
        sessionList.innerHTML = sessionStore.map((session) => {
          const selected = session.id === activeSessionId ? "true" : "false";
          return '<li class="session-list-row" data-testid="friend-session-item"><button class="friend-session-item" data-session-id="' + escapeText(session.id) + '" aria-selected="' + selected + '" type="button"><strong>' + escapeText(session.title || "新会话") + '</strong><span>' + escapeText(session.status || "waiting") + '</span></button></li>';
        }).join("");
      }

      function renderChatThread() {
        const session = activeSession();
        const messages = session?.messages ?? [];
        if (!chatThread) {
          return;
        }
        if (messages.length === 0) {
          chatThread.innerHTML = '<article class="chat-message assistant-message" data-testid="friend-chat-message"><span class="chat-message-role">Agent</span><p class="chat-message-content">这个会话还没有消息。</p></article>';
          if (taskResult) {
            taskResult.innerHTML = "";
          }
          return;
        }
        const html = messages.filter((message) => !isHiddenConversationEventType(message.type)).map((message) => {
          if (message.type === "approval") {
            return '<article class="chat-message approval-message" data-task-id="' + escapeText(message.taskId || "") + '" data-testid="friend-approval-card"><span class="chat-message-role">确认</span><p class="chat-message-content">' + escapeText(message.content) + '</p><div class="approval-actions"><button class="approve-friend-confirmation secondary-button" data-request-id="' + escapeText(message.requestId || "") + '" type="button">批准</button><button class="deny-friend-confirmation danger-button" data-request-id="' + escapeText(message.requestId || "") + '" type="button">拒绝</button></div></article>';
          }
          return '<article class="chat-message ' + escapeText(message.role || "agent") + '-message" data-task-id="' + escapeText(message.taskId || "") + '" data-event-type="' + escapeText(message.type || "message") + '" data-testid="friend-chat-message"><span class="chat-message-role">' + escapeText(message.role === "user" ? "你" : eventLabel(message)) + '</span><p class="chat-message-content">' + escapeText(message.content || "") + '</p></article>';
        }).join("");
        chatThread.innerHTML = html;
        chatThread.scrollTop = chatThread.scrollHeight;
        if (taskResult) {
          taskResult.innerHTML = html;
        }
      }

      function appendConversationEvents(events, taskId = currentTaskId, sessionId = activeSessionId) {
        (events ?? []).forEach((item, index) => {
          if (isHiddenConversationEventType(item.type)) {
            return;
          }
          const resolvedTaskId = String(item.taskId ?? taskId ?? "");
          appendChatMessage({
            role: item.type === "user.task" ? "user" : "assistant",
            type: item.type ?? "event",
            taskId: resolvedTaskId,
            content: eventContent(item),
            key: conversationEventKey(item, resolvedTaskId, index),
          }, sessionId);
        });
      }

      function appendUserTaskFromAgUi(message, taskId, sessionId) {
        if (!message || message.role !== "user" || !message.content) {
          return;
        }
        const session = sessionById(sessionId);
        const content = String(message.content);
        if ((session?.messages ?? []).some((item) => {
          return item.type === "user.task"
            && String(item.taskId || "") === String(taskId || "")
            && String(item.content || "") === content;
        })) {
          return;
        }
        appendChatMessage({
          role: "user",
          type: "user.task",
          taskId,
          content,
          key: "ag-ui:user:" + String(message.id || taskId || content),
        }, sessionId);
      }

      function upsertAgUiAssistantOutput(sessionId, taskId, content, messageId) {
        const session = sessionById(sessionId);
        if (!session || !content) {
          return;
        }
        const existingOutput = (session.messages ?? []).find((item) => {
          return item.type === "task.output" && String(item.taskId || "") === String(taskId || "");
        });
        if (existingOutput) {
          if (String(existingOutput.content || "") === content) {
            return;
          }
          existingOutput.content = content;
          session.messageKeys = session.messageKeys || [];
          const key = "ag-ui:assistant:" + String(messageId || taskId || content);
          if (!session.messageKeys.includes(key)) {
            session.messageKeys.push(key);
          }
          session.updatedAt = new Date().toISOString();
          saveSessionStore();
          renderSessionList();
          if (session.id === activeSessionId) {
            renderChatThread();
          }
          return;
        }
        appendChatMessage({
          role: "assistant",
          type: "task.output",
          taskId,
          content,
          key: "ag-ui:assistant:" + String(messageId || taskId || content),
        }, sessionId);
      }

      function appendAgUiCustomEvent(item, taskId, sessionId) {
        const value = item?.value ?? {};
        switch (item?.name) {
          case "ralphloop.task.plan":
            appendConversationEvents([{ type: "task.plan", taskId, text: value.text || "" }], taskId, sessionId);
            return;
          case "ralphloop.task.progress":
            appendConversationEvents([{ type: "task.progress", taskId, text: value.text || "" }], taskId, sessionId);
            return;
          case "ralphloop.task.needs_user_auth":
            appendConversationEvents([{
              type: "task.needs_user_auth",
              taskId,
              provider: value.provider || "",
              scopeSummary: value.scopeSummary || "",
            }], taskId, sessionId);
            return;
          case "ralphloop.task.needs_user_confirm":
            appendConversationEvents([{
              type: "task.needs_user_confirm",
              taskId,
              actionSummary: value.actionSummary || "",
            }], taskId, sessionId);
            return;
          case "ralphloop.task.needs_owner_approval":
            appendConversationEvents([{
              type: "task.needs_owner_approval",
              taskId,
              actionSummary: value.actionSummary || "",
            }], taskId, sessionId);
            return;
          case "ralphloop.run.cancelled":
            appendConversationEvents([{ type: "task.cancelled", taskId }], taskId, sessionId);
            return;
        }
      }

      function appendAgUiConversationEvents(events, taskId = currentTaskId, sessionId = activeSessionId) {
        const assistantContentByMessageId = new Map();
        const assistantMessageOrder = [];
        (events ?? []).forEach((item) => {
          switch (item.type) {
            case "RUN_STARTED":
              (item.input?.messages ?? []).forEach((message) => {
                appendUserTaskFromAgUi(message, taskId || item.runId, sessionId);
              });
              return;
            case "TEXT_MESSAGE_START":
              if (!assistantContentByMessageId.has(item.messageId)) {
                assistantContentByMessageId.set(item.messageId, "");
                assistantMessageOrder.push(item.messageId);
              }
              return;
            case "TEXT_MESSAGE_CONTENT":
              if (!assistantContentByMessageId.has(item.messageId)) {
                assistantContentByMessageId.set(item.messageId, "");
                assistantMessageOrder.push(item.messageId);
              }
              assistantContentByMessageId.set(
                item.messageId,
                String(assistantContentByMessageId.get(item.messageId) || "") + String(item.delta || ""),
              );
              return;
            case "RUN_ERROR":
              appendConversationEvents([{
                type: "task.failed",
                taskId: taskId || item.runId,
                message: item.message || friendlyTaskFailureMessage(),
              }], taskId || item.runId, sessionId);
              return;
            case "CUSTOM":
              appendAgUiCustomEvent(item, taskId, sessionId);
              return;
          }
        });
        assistantMessageOrder.forEach((messageId) => {
          upsertAgUiAssistantOutput(
            sessionId,
            taskId,
            String(assistantContentByMessageId.get(messageId) || ""),
            messageId,
          );
        });
      }

      function renderEvents(events, taskId = currentTaskId, sessionId = activeSessionId) {
        appendConversationEvents(events, taskId, sessionId);
      }

      function renderPreviewFrame(frames) {
        if (!previewFrame) {
          return;
        }
        const latest = (frames ?? []).at(-1);
        if (!latest) {
          previewFrame.innerHTML = '<span>' + escapeText(previewLabel) + '</span>';
          return;
        }
        if (latest.contentType === "text/plain") {
          try {
            previewFrame.textContent = atob(String(latest.data ?? ""));
          } catch {
            previewFrame.textContent = previewLabel;
          }
          return;
        }
        if (String(latest.contentType ?? "").startsWith("image/")) {
          previewFrame.innerHTML = '<img alt="预览" src="data:' + escapeText(latest.contentType) + ';base64,' + escapeText(latest.data) + '">';
          return;
        }
        previewFrame.textContent = previewLabel;
      }

      async function refreshPreview(sessionId = activeSessionId, taskId = currentTaskId) {
        const shouldRender = sessionId === activeSessionId && taskId === currentTaskId;
        if (!sessionId || !taskId) {
          if (shouldRender) {
            renderPreviewFrame([]);
          }
          return;
        }
        const response = await fetch(${previewEndpoint} + "?sessionId=" + encodeURIComponent(sessionId) + "&taskId=" + encodeURIComponent(taskId));
        const body = await response.json();
        if (!response.ok) {
          if (shouldRender) {
            renderPreviewFrame([]);
          }
          return;
        }
        if (shouldRender) {
          renderPreviewFrame(body.frames ?? []);
        }
      }

      async function refreshTaskEvents(sessionId = activeSessionId, taskId = currentTaskId) {
        if (!taskId || !sessionId) {
          return [];
        }
        const response = await fetch(${eventsEndpoint} + "?sessionId=" + encodeURIComponent(sessionId) + "&taskId=" + encodeURIComponent(taskId) + "&format=ag-ui");
        let body = {};
        try {
          body = await response.json();
        } catch {
          return [];
        }
        if (!response.ok) {
          return [];
        }
        const events = body.events ?? [];
        if (body.format === "ag-ui") {
          appendAgUiConversationEvents(events, taskId, sessionId);
        } else {
          appendConversationEvents(events, taskId, sessionId);
        }
        return events;
      }

      function statusFromEvents(events) {
        if ((events ?? []).some((item) => item.type === "task.failed" || item.type === "RUN_ERROR")) {
          return "失败";
        }
        if ((events ?? []).some((item) => item.type === "task.cancelled" || (item.type === "RUN_FINISHED" && item.result?.status === "cancelled"))) {
          return "已取消";
        }
        if ((events ?? []).some((item) => item.type === "task.completed" || (item.type === "RUN_FINISHED" && item.result?.status !== "cancelled"))) {
          return "已完成";
        }
        return "运行中";
      }

      function taskStateFromEvents(events) {
        if ((events ?? []).some((item) => item.type === "task.failed" || item.type === "RUN_ERROR")) {
          return "failed";
        }
        if ((events ?? []).some((item) => item.type === "task.cancelled" || (item.type === "RUN_FINISHED" && item.result?.status === "cancelled"))) {
          return "cancelled";
        }
        if ((events ?? []).some((item) => item.type === "task.completed" || (item.type === "RUN_FINISHED" && item.result?.status !== "cancelled"))) {
          return "completed";
        }
        return "running";
      }

      function isTerminalTaskEvents(events) {
        return (events ?? []).some((item) => {
          return terminalTaskEventTypes.has(item.type)
            || item.type === "RUN_ERROR"
            || item.type === "RUN_FINISHED";
        });
      }

      async function pollTaskUntilTerminal(remainingAttempts = 20, sessionId = activeSessionId, taskId = currentTaskId) {
        if (!taskId || !sessionId || remainingAttempts <= 0) {
          return;
        }
        const pollKey = sessionId + ":" + taskId;
        const events = await refreshTaskEvents(sessionId, taskId);
        await refreshPreview(sessionId, taskId);
        if (sessionId === activeSessionId && taskId === currentTaskId) {
          setStatus(statusFromEvents(events));
        }
        if (isTerminalTaskEvents(events)) {
          if (taskPollTimers.has(pollKey)) {
            window.clearTimeout(taskPollTimers.get(pollKey));
            taskPollTimers.delete(pollKey);
          }
          updateSessionTaskState(sessionId, taskId, taskStateFromEvents(events));
          return;
        }
        const pollTimer = window.setTimeout(() => {
          taskPollTimers.delete(pollKey);
          void pollTaskUntilTerminal(remainingAttempts - 1, sessionId, taskId);
        }, 750);
        taskPollTimers.set(pollKey, pollTimer);
      }

      async function newSession() {
        if (sessionCreationPromise) {
          return await sessionCreationPromise;
        }
        sessionCreationPromise = (async () => {
          const response = await fetch(${sessionEndpoint}, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({}),
          });
          const body = await response.json();
          if (!response.ok || !body.session) {
            setStatus("会话创建失败");
            return "";
          }
          const session = upsertSession({
            id: body.session.id,
            title: "新会话",
            status: body.session.status || "waiting",
            updatedAt: body.session.startedAt || new Date().toISOString(),
            messages: [],
            messageKeys: [],
            currentTaskId: "",
          });
          activeSessionId = session.id;
          currentSessionId = session.id;
          currentTaskId = session.currentTaskId || "";
          saveSessionStore();
          renderSessionList();
          renderChatThread();
          setStatus("等待消息");
          await refreshConfirmations();
          return activeSessionId;
        })();
        try {
          return await sessionCreationPromise;
        } finally {
          sessionCreationPromise = undefined;
        }
      }

      async function ensureSession() {
        if (activeSessionId && activeSession()) {
          currentSessionId = activeSessionId;
          return activeSessionId;
        }
        return await newSession();
      }

      async function switchSession(sessionId) {
        if (!sessionId || !sessionStore.some((session) => session.id === sessionId)) {
          return;
        }
        activeSessionId = sessionId;
        currentSessionId = sessionId;
        currentTaskId = activeSession()?.currentTaskId || "";
        saveSessionStore();
        renderSessionList();
        renderChatThread();
        setStatus(currentTaskId ? "已切换会话" : "等待消息");
        if (currentTaskId) {
          const events = await refreshTaskEvents(activeSessionId, currentTaskId);
          if (isTerminalTaskEvents(events)) {
            updateSessionTaskState(activeSessionId, currentTaskId, taskStateFromEvents(events));
          }
          setStatus(statusFromEvents(events));
          await refreshPreview(activeSessionId, currentTaskId);
        } else {
          renderPreviewFrame([]);
        }
        await refreshConfirmations();
      }

      async function refreshConfirmations() {
        const session = activeSession();
        if (!activeSessionId || !session) {
          return;
        }
        const response = await fetch(${confirmationsEndpoint} + "?sessionId=" + encodeURIComponent(activeSessionId));
        const body = await response.json();
        const confirmations = body.confirmations ?? [];
        session.messages = (session.messages ?? []).filter((message) => message.type !== "approval");
        session.messageKeys = (session.messageKeys ?? []).filter((key) => !String(key).startsWith("approval:"));
        confirmations.forEach((request) => {
          appendChatMessage({
            role: "assistant",
            type: "approval",
            requestId: request.id,
            taskId: request.taskId || "",
            content: String(request.summary || request.actionType || "需要确认"),
            key: "approval:" + String(request.id),
          });
        });
        saveSessionStore();
        renderChatThread();
      }

      async function resolveFriendConfirmation(requestId, action) {
        const sessionId = await ensureSession();
        if (!sessionId) {
          return;
        }
        await fetch(${confirmationsEndpoint} + "/" + encodeURIComponent(requestId) + "/" + action, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        await refreshConfirmations();
      }

      function enqueueSessionSubmit(sessionId, operation) {
        const previous = sessionSubmitQueues.get(sessionId) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(operation);
        const tracked = next.finally(() => {
          if (sessionSubmitQueues.get(sessionId) === tracked) {
            sessionSubmitQueues.delete(sessionId);
          }
        });
        sessionSubmitQueues.set(sessionId, tracked);
        return next;
      }

      function nextOptimisticTaskId() {
        optimisticMessageCounter += 1;
        return "pending-" + String(optimisticMessageCounter);
      }

      function replacePendingTaskId(sessionId, pendingTaskId, taskId) {
        if (!pendingTaskId || !taskId || pendingTaskId === taskId) {
          return;
        }
        const session = sessionById(sessionId);
        if (!session) {
          return;
        }
        (session.messages ?? []).forEach((message) => {
          if (message.taskId === pendingTaskId) {
            message.taskId = taskId;
          }
        });
        if (session.currentTaskId === pendingTaskId) {
          session.currentTaskId = taskId;
        }
        saveSessionStore();
        if (sessionId === activeSessionId) {
          currentTaskId = taskId;
          renderChatThread();
        }
      }

      function friendlyTaskFailureMessage() {
        return "任务提交失败，请稍后重试";
      }

      function updateSessionTaskState(sessionId, taskId, status) {
        const session = sessionById(sessionId);
        if (!session) {
          return;
        }
        const nextStatus = status || "running";
        const currentTaskIdForSession = String(session.currentTaskId || "");
        const staleTerminalUpdate = ["completed", "failed", "cancelled"].includes(nextStatus)
          && currentTaskIdForSession
          && currentTaskIdForSession !== taskId;
        if (!staleTerminalUpdate) {
          session.currentTaskId = taskId;
          session.status = nextStatus;
        }
        saveSessionStore();
        renderSessionList();
        if (sessionId === activeSessionId) {
          currentSessionId = sessionId;
          if (!staleTerminalUpdate) {
            currentTaskId = taskId;
          }
          updateComposerState();
        }
      }

      function clearPromptValues(promptElement) {
        if (promptElement) {
          promptElement.value = "";
        }
        if (promptElement !== chatPrompt && chatPrompt) {
          chatPrompt.value = "";
        }
        if (promptElement !== taskPrompt && taskPrompt) {
          taskPrompt.value = "";
        }
      }

      async function submitQueuedChatMessage(sessionId, prompt, pendingTaskId) {
        let response;
        let body = {};
        try {
          response = await fetch(${taskEndpoint}, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sessionId: sessionId || undefined,
              prompt,
            }),
          });
          body = await response.json();
        } catch {
          if (sessionId === activeSessionId) {
            setStatus("提交失败");
          }
          appendConversationEvents([
            { type: "task.failed", taskId: pendingTaskId, message: friendlyTaskFailureMessage() },
          ], pendingTaskId, sessionId);
          await refreshConfirmations();
          return;
        }

        const submittedTaskId = String(body.task?.id ?? pendingTaskId);
        replacePendingTaskId(sessionId, pendingTaskId, submittedTaskId);
        if (sessionById(sessionId)?.status === "cancelled") {
          updateSessionTaskState(sessionId, submittedTaskId, "cancelled");
          if (sessionId === activeSessionId) {
            setStatus("已取消");
          }
          await refreshConfirmations();
          return;
        }
        if (!response.ok || !body.task) {
          updateSessionTaskState(sessionId, submittedTaskId, "failed");
          if (sessionId === activeSessionId) {
            setStatus("提交失败");
          }
          appendConversationEvents([
            { type: "task.failed", taskId: submittedTaskId, message: friendlyTaskFailureMessage() },
          ], submittedTaskId, sessionId);
          await refreshConfirmations();
          return;
        }

        updateSessionTaskState(sessionId, submittedTaskId, body.task?.status ?? "running");
        if (sessionId === activeSessionId) {
          setStatus(body.task?.status === "completed" ? "已完成" : body.task?.status === "failed" ? "失败" : "运行中");
        }
        renderEvents(body.events ?? [], submittedTaskId, sessionId);
        await refreshPreview(sessionId, submittedTaskId);
        await refreshTaskEvents(sessionId, submittedTaskId);
        if (sessionId === activeSessionId) {
          await refreshConfirmations();
        }
        if (["completed", "failed", "cancelled"].includes(body.task?.status ?? "")) {
          return;
        }
        void pollTaskUntilTerminal(20, sessionId, submittedTaskId);
      }

      async function submitChatMessage(event, formElement, promptElement) {
        event.preventDefault();
        const prompt = String(promptElement?.value ?? "");
        if (!prompt.trim()) {
          setStatus("请输入任务");
          return;
        }
        const sessionId = await ensureSession();
        if (!sessionId) {
          return;
        }
        const pendingTaskId = nextOptimisticTaskId();
        appendConversationEvents([{ type: "user.task", taskId: pendingTaskId, text: prompt }], pendingTaskId, sessionId);
        updateSessionTaskState(sessionId, pendingTaskId, "running");
        clearPromptValues(promptElement);
        if (sessionId === activeSessionId) {
          setStatus("发送中");
        }
        await enqueueSessionSubmit(sessionId, () => submitQueuedChatMessage(sessionId, prompt, pendingTaskId));
      }

      async function stopActiveTask() {
        const session = activeSession();
        const sessionId = activeSessionId;
        const taskId = session?.currentTaskId || currentTaskId;
        if (!sessionId || !taskId || !activeSessionIsBusy()) {
          setStatus("没有正在运行的任务");
          return;
        }
        const pollKey = sessionId + ":" + taskId;
        if (taskPollTimers.has(pollKey)) {
          window.clearTimeout(taskPollTimers.get(pollKey));
          taskPollTimers.delete(pollKey);
        }
        setStatus("正在停止");
        try {
          const response = await fetch(${sessionEndpoint} + "/" + encodeURIComponent(sessionId) + "/cancel", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ taskId }),
          });
          if (!response.ok) {
            throw new Error("cancel_failed");
          }
          updateSessionTaskState(sessionId, taskId, "cancelled");
          appendConversationEvents([{ type: "task.cancelled", taskId }], taskId, sessionId);
          setStatus("已取消");
          await refreshConfirmations();
        } catch {
          setStatus("停止失败");
        }
      }

      function runFriendAction(operation, failureStatus) {
        return operation().catch(() => {
          if (failureStatus) {
            setStatus(failureStatus);
          }
        });
      }

      chatForm?.addEventListener("submit", (event) => {
        return runFriendAction(() => submitChatMessage(event, chatForm, chatPrompt), "提交失败");
      });

      chatPrompt?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) {
          return;
        }
        event.preventDefault();
        return runFriendAction(() => submitChatMessage(event, chatForm, chatPrompt), "提交失败");
      });

      chatStop?.addEventListener("click", () => {
        return runFriendAction(() => stopActiveTask(), "停止失败");
      });

      taskForm?.addEventListener("submit", (event) => {
        return runFriendAction(() => submitChatMessage(event, taskForm, taskPrompt), "提交失败");
      });

      sessionList?.addEventListener("click", (event) => {
        const target = event.target;
        const sessionButton = target?.closest?.(".friend-session-item");
        const sessionId = target?.dataset?.sessionId ?? sessionButton?.dataset?.sessionId;
        if (sessionId) {
          return runFriendAction(() => switchSession(sessionId), "切换会话失败");
        }
      });

      newSessionButton?.addEventListener("click", () => {
        return runFriendAction(() => newSession(), "会话创建失败");
      });

      chatThread?.addEventListener("click", (event) => {
        const target = event.target;
        if (target?.classList?.contains("approve-friend-confirmation")) {
          return runFriendAction(() => resolveFriendConfirmation(target.dataset.requestId, "approve"), "确认失败");
        }
        if (target?.classList?.contains("deny-friend-confirmation")) {
          return runFriendAction(() => resolveFriendConfirmation(target.dataset.requestId, "deny"), "确认失败");
        }
      });

      function setPreviewDrawerOpen(open) {
        if (!previewDrawer) {
          return;
        }
        previewDrawer.setAttribute("aria-hidden", open ? "false" : "true");
        if (previewDrawer.classList?.add && previewDrawer.classList?.remove) {
          if (open) {
            previewDrawer.classList.add("is-open");
          } else {
            previewDrawer.classList.remove("is-open");
          }
        }
      }

      previewToggle?.addEventListener("click", () => {
        setPreviewDrawerOpen(true);
        return runFriendAction(() => refreshPreview(), "");
      });

      previewClose?.addEventListener("click", () => {
        setPreviewDrawerOpen(false);
      });

      async function bootstrapFriendChat() {
        setPreviewDrawerOpen(false);
        renderSessionList();
        if (activeSessionId && activeSession()) {
          await switchSession(activeSessionId);
          return;
        }
        await newSession();
      }

      void bootstrapFriendChat();
    </script>
  `);
}

function renderFriendUnavailablePage(): string {
  return htmlPage("Ralphloop Share Unavailable", `
    <main class="app-shell friend-shell unavailable-shell">
      <header class="topbar agent-console-topbar">
        <div>
          <p class="eyebrow">Ralphloop · 朋友链接</p>
          <h1>链接暂不可用</h1>
          <p class="console-subtitle">请联系分享者确认链接状态。</p>
        </div>
      </header>

      <section class="surface unavailable-surface" aria-label="链接暂不可用">
        <div class="section-heading">
          <h2>无法连接到这个 Agent</h2>
          <span>中性状态</span>
        </div>
        <p class="muted-label">这个分享链接可能已暂停、撤销、过期，或 Host 暂时离线。请联系分享者重新启用或发送新的链接。</p>
      </section>
    </main>
  `);
}

function renderAssistantUiSharePage(input: {
  token: string;
  agentName: string;
  currentThreadId: string;
  taskId: string;
  shellHtml: string;
}): string {
  const state = JSON.stringify({
    token: input.token,
    currentThreadId: input.currentThreadId,
    taskId: input.taskId,
  });
  return htmlPage("Ralphloop Assistant UI", `
    <div class="app-shell friend-shell assistant-ui-shell-page">
      <header class="topbar agent-console-topbar">
        <div>
          <p class="eyebrow">RALPHLOOP · assistant-ui</p>
          <h1>${escapeHtml(input.agentName)}</h1>
          <p class="console-subtitle">React runtime shell</p>
        </div>
        <a class="secondary-button" href="/app/share/${encodeURIComponent(input.token)}/classic">打开经典页</a>
      </header>

      <section class="surface assistant-ui-surface" aria-label="assistant-ui 运行时">
        ${input.shellHtml}
      </section>
    </div>
    <script type="application/json" id="assistant-ui-state">${escapeScriptJson(state)}</script>
    <script>${createAssistantUiShareClientScript()}</script>
  `);
}

function renderAssistantUiReactShellInSubprocess(input: {
  token: string;
  currentThreadId: string;
  threadTitle: string;
  taskId: string;
  events: unknown[];
}): string {
  const script = `
    let raw = "";
    for await (const chunk of process.stdin) {
      raw += chunk;
    }
    const input = JSON.parse(raw);
    const { createFriendAgUiRuntimeStore } = await import("./apps/share-web/src/runtime/friendAgUiRuntimeStore.ts");
    const { renderAssistantUiReactShellToString } = await import("./apps/share-web/src/runtime/assistantUiReactShell.ts");
    const store = createFriendAgUiRuntimeStore({
      baseUrl: "",
      token: input.token,
      currentThreadId: input.currentThreadId,
      threads: [{
        id: input.currentThreadId,
        title: input.threadTitle,
        status: "regular",
        taskId: input.taskId,
        events: input.events,
      }],
      fetch: async () => new Response(JSON.stringify({ events: [] }), {
        headers: { "content-type": "application/json" },
      }),
    });
    process.stdout.write(renderAssistantUiReactShellToString(store));
    process.exit(0);
  `;
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "-e",
    script,
  ], {
    cwd: process.cwd(),
    input: JSON.stringify(input),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || "assistant-ui shell render failed");
  }
  return result.stdout;
}

const reactV2DistDir = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "share-web-react",
  "dist",
);
const reactV2AssetsDir = resolvePath(reactV2DistDir, "assets");
const reactV2IndexPath = resolvePath(reactV2DistDir, "index.html");

const reactV2AssetContentTypes: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
};

function serveReactV2Asset(input: {
  response: ServerResponse;
  assetPath: string;
}): void {
  const decoded = (() => {
    try {
      return decodeURIComponent(input.assetPath);
    } catch {
      return "";
    }
  })();
  if (!decoded || decoded.includes("\0")) {
    sendJson(input.response, 400, { error: "invalid_asset_path" });
    return;
  }
  const resolved = resolvePath(reactV2AssetsDir, decoded);
  const assetsRoot = reactV2AssetsDir.endsWith(sep)
    ? reactV2AssetsDir
    : `${reactV2AssetsDir}${sep}`;
  if (resolved !== reactV2AssetsDir && !resolved.startsWith(assetsRoot)) {
    sendJson(input.response, 400, { error: "invalid_asset_path" });
    return;
  }
  if (!existsSync(resolved)) {
    sendJson(input.response, 404, { error: "asset_not_found" });
    return;
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolved);
  } catch {
    sendJson(input.response, 404, { error: "asset_not_found" });
    return;
  }
  const contentType = reactV2AssetContentTypes[extname(resolved).toLowerCase()]
    ?? "application/octet-stream";
  input.response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "public, max-age=31536000, immutable",
  });
  input.response.end(bytes);
}

function renderReactV2SharePage(input: {
  token: string;
  agentName: string;
  sessionId: string;
  taskId: string;
  events: unknown[];
}): string {
  if (!existsSync(reactV2IndexPath)) {
    throw new Error(
      "apps/share-web-react/dist/index.html missing; run `npm run build:web-react` first",
    );
  }
  const template = readFileSync(reactV2IndexPath, "utf8");
  // When the friend lands without a sessionId the store creates one lazily on the
  // first message; only seed an initial thread when the gateway already knows
  // about a live session for this share token.
  const threads = input.sessionId
    ? [
      {
        id: input.sessionId,
        title: input.agentName,
        status: "regular",
        taskId: input.taskId,
        events: input.events,
      },
    ]
    : [];
  const state = JSON.stringify({
    token: input.token,
    agentName: input.agentName,
    currentThreadId: input.sessionId,
    taskId: input.taskId,
    threads,
  });
  const safeToken = encodeURIComponent(input.token);
  const stateScript = `<script type="application/json" id="ralphloop-state">${escapeScriptJson(state)}</script>`;
  // Vite emitted the index with the `__TOKEN__` placeholder for the share-token
  // segment of its `base`; rewrite per-request so the hashed assets resolve to
  // /app/share/<token>/v2/assets/...
  const rewritten = template
    .replaceAll("__TOKEN__", safeToken)
    // Mirror the hydrated app marker into the static shell so contract tests
    // and `data-ralphloop-react-app` selectors work before client JS executes.
    .replace(
      `<div id="root" data-ralphloop-react-root="true">`,
      `<div id="root" data-ralphloop-react-root="true" data-ralphloop-react-app="true">`,
    );
  if (rewritten.includes("</body>")) {
    return rewritten.replace("</body>", `${stateScript}</body>`);
  }
  return `${rewritten}${stateScript}`;
}

function escapeScriptJson(value: string): string {
  return value
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${appCss()}</style></head><body>${body}</body></html>`;
}

function sendHtml(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

function sendRedirect(response: ServerResponse, location: string) {
  response.writeHead(302, { location });
  response.end();
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function appCss(): string {
  return `
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --surface: #ffffff;
      --surface-soft: #eef6f4;
      --border: #d9e2ec;
      --text: #101828;
      --muted: #667085;
      --teal: #0f766e;
      --blue: #2563eb;
      --ink: #172033;
      --shadow: 0 18px 45px rgb(16 24 40 / 0.08);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    button,
    input,
    textarea {
      font: inherit;
    }

    .app-shell {
      width: min(1080px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0;
    }

    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 24px;
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--teal);
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
    }

    h1,
    h2,
    p {
      margin: 0;
    }

    h1 {
      color: var(--ink);
      font-size: 32px;
      line-height: 1.15;
      font-weight: 750;
    }

    h2 {
      color: var(--ink);
      font-size: 15px;
      line-height: 1.3;
    }

    .status-pill,
    .status-line {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      border: 1px solid #b8ded8;
      border-radius: 999px;
      background: var(--surface-soft);
      color: #0b635d;
      padding: 5px 12px;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }

    .workspace-grid,
    .composer-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 0.75fr);
      gap: 16px;
      align-items: stretch;
    }

    .agent-console-shell {
      width: min(1180px, calc(100% - 32px));
    }

    .agent-console-topbar {
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 18px;
    }

    .console-subtitle {
      margin-top: 8px;
      color: var(--muted);
      font-size: 14px;
      font-weight: 650;
    }

    .status-cluster {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    .agent-console-grid {
      grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr);
      align-items: start;
    }

    .agent-main-panel {
      display: grid;
      gap: 16px;
      min-width: 0;
    }

    .surface {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
      padding: 18px;
    }

    .section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
      color: var(--muted);
      font-size: 13px;
    }

    .runtime-list {
      display: grid;
      gap: 10px;
      margin: 0;
    }

    .runtime-list div {
      display: grid;
      grid-template-columns: 80px minmax(0, 1fr);
      gap: 16px;
      padding: 12px 0;
      border-top: 1px solid var(--border);
    }

    .runtime-list dt {
      color: var(--muted);
      font-size: 13px;
    }

    .runtime-list dd {
      margin: 0;
      color: var(--ink);
      font-weight: 650;
    }

    .adapter-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
      margin-top: 16px;
    }

    .adapter-choice {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 42px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #f9fbfd;
      color: var(--ink);
      padding: 0 12px;
      font-size: 14px;
      font-weight: 700;
    }

    .action-surface {
      display: flex;
      flex-direction: column;
      min-height: 206px;
    }

    button {
      min-height: 42px;
      border: 0;
      border-radius: 8px;
      background: var(--blue);
      color: white;
      cursor: pointer;
      font-weight: 750;
      padding: 0 16px;
    }

    button:disabled {
      cursor: wait;
      opacity: 0.7;
    }

    .secondary-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      border: 1px solid var(--border);
      background: white;
      color: var(--ink);
      padding: 0 12px;
      font-size: 13px;
      text-decoration: none;
    }

    .danger-button {
      background: #b42318;
      color: white;
    }

    .share-output {
      min-height: 48px;
      margin-top: 16px;
      border: 1px dashed #b9c7d6;
      border-radius: 8px;
      background: #f9fbfd;
      padding: 12px;
      overflow-wrap: anywhere;
      color: var(--muted);
    }

    .share-output a {
      color: var(--blue);
      font-weight: 700;
      text-decoration: none;
    }

    .owner-controls {
      display: flex;
      gap: 10px;
      margin-top: auto;
      padding-top: 14px;
    }

    .audit-surface,
    .history-surface,
    .approval-surface,
    .confirmation-surface {
      margin-top: 16px;
    }

    .audit-log,
    .owner-list,
    .approval-list {
      display: grid;
      gap: 8px;
      min-height: 68px;
      margin: 0;
      padding-left: 20px;
      color: var(--muted);
      font-size: 13px;
    }

    .audit-log li,
    .owner-list li,
    .approval-list li {
      padding: 8px 0;
      border-top: 1px solid var(--border);
    }

    .audit-log strong,
    .owner-list strong,
    .approval-list strong {
      color: var(--ink);
      margin-right: 8px;
    }

    .share-link-list-item {
      display: grid;
      gap: 10px;
    }

    .share-link-summary {
      display: grid;
      gap: 4px;
    }

    .share-link-edit-form {
      display: grid;
      grid-template-columns: minmax(180px, 0.75fr) minmax(220px, 1fr) auto;
      gap: 10px;
      align-items: end;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fbfcfe;
    }

    .share-link-name-field {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
    }

    .share-link-name-input {
      width: 100%;
      min-height: 34px;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--ink);
      padding: 0 10px;
      outline: none;
    }

    .share-link-name-input:focus {
      border-color: #7aa7f7;
      box-shadow: 0 0 0 3px rgb(37 99 235 / 0.14);
    }

    .share-link-adapter-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      min-width: 0;
      margin: 0;
      border: 0;
      padding: 0;
    }

    .share-link-adapter-list legend {
      width: 100%;
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
      padding: 0;
    }

    .share-link-adapter-choice {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 30px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: white;
      color: var(--ink);
      padding: 0 8px;
      font-size: 12px;
      font-weight: 750;
    }

    .approval-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .muted-label {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    .composer-surface {
      display: grid;
      gap: 12px;
    }

    .agent-composer {
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      padding: 0;
    }

    .composer-surface label {
      color: var(--ink);
      font-weight: 750;
    }

    textarea {
      width: 100%;
      min-height: 210px;
      resize: vertical;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      padding: 12px;
      outline: none;
    }

    .agent-composer textarea {
      min-height: 168px;
      background: #fbfcfe;
      line-height: 1.5;
    }

    textarea:focus {
      border-color: #7aa7f7;
      box-shadow: 0 0 0 3px rgb(37 99 235 / 0.14);
    }

    .composer-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .composer-button-row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
    }

    .danger-outline {
      border-color: #f5c2bd;
      color: #9f1b12;
    }

    .agent-thread {
      border-top: 1px solid var(--border);
      padding-top: 16px;
    }

    .preview-surface {
      display: grid;
      gap: 14px;
      align-content: start;
    }

    .agent-preview-panel {
      min-height: 100%;
    }

    .preview-frame {
      display: grid;
      min-height: 210px;
      place-items: center;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #f8fafc;
      color: var(--muted);
      font-weight: 700;
    }

    .agent-preview-panel .preview-frame {
      min-height: 360px;
      background:
        linear-gradient(90deg, rgb(15 23 42 / 0.04) 1px, transparent 1px),
        linear-gradient(rgb(15 23 42 / 0.04) 1px, transparent 1px),
        #fbfcfe;
      background-size: 24px 24px;
      text-align: center;
    }

    .preview-frame img {
      width: 100%;
      max-height: 210px;
      object-fit: contain;
      border-radius: 6px;
    }

    .agent-preview-panel .preview-frame img {
      max-height: 340px;
    }

    .output-surface {
      margin-top: 16px;
    }

    .task-output {
      display: block;
      min-height: 88px;
      white-space: pre-wrap;
      border-radius: 8px;
      background: #111827;
      color: #d1fae5;
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.5;
    }

    .agent-thread-output {
      display: grid;
      gap: 10px;
      min-height: 220px;
      max-height: 420px;
      overflow: auto;
      background: #0b1220;
      color: #d6e4ff;
    }

    .thread-empty {
      color: #95a3b8;
      font-family: inherit;
    }

    .thread-event {
      display: grid;
      grid-template-columns: 72px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
      border-bottom: 1px solid rgb(255 255 255 / 0.08);
      padding-bottom: 10px;
    }

    .thread-event-label {
      color: #a7f3d0;
      font-size: 12px;
      font-weight: 800;
    }

    .thread-event-body {
      min-width: 0;
      overflow-wrap: anywhere;
      color: #e5edf8;
    }

    .friend-chat-shell {
      width: min(1320px, calc(100% - 32px));
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      gap: 16px;
      min-height: calc(100vh - 64px);
      position: relative;
    }

    .friend-session-sidebar {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 16px;
      align-self: stretch;
      min-height: 0;
      box-shadow: none;
    }

    .friend-session-sidebar h1 {
      font-size: 24px;
      line-height: 1.2;
    }

    .new-session-button {
      width: 100%;
      justify-content: center;
    }

    .session-list {
      display: grid;
      align-content: start;
      gap: 8px;
      min-height: 0;
      margin: 0;
      padding: 0;
      overflow: auto;
      list-style: none;
    }

    .session-list-row,
    .session-empty,
    .session-item-placeholder {
      list-style: none;
    }

    .friend-session-item {
      display: grid;
      width: 100%;
      min-height: 58px;
      border: 1px solid var(--border);
      background: #f9fbfd;
      color: var(--ink);
      text-align: left;
      padding: 10px 12px;
    }

    .friend-session-item[aria-selected="true"] {
      border-color: #8dc8bf;
      background: #eef8f6;
      box-shadow: inset 3px 0 0 var(--teal);
    }

    .friend-session-item span {
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    .friend-chat-main {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-width: 0;
      min-height: 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .friend-chat-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid var(--border);
      padding: 16px 18px;
    }

    .friend-chat-topbar h2 {
      font-size: 18px;
    }

    .chat-thread {
      display: grid;
      align-content: start;
      gap: 14px;
      min-height: 360px;
      max-height: calc(100vh - 292px);
      overflow: auto;
      background: #fbfcfe;
      padding: 20px;
    }

    .chat-message {
      display: grid;
      gap: 6px;
      width: min(760px, 92%);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: white;
      padding: 12px 14px;
      color: var(--ink);
      box-shadow: 0 10px 24px rgb(16 24 40 / 0.06);
    }

    .user-message {
      justify-self: end;
      border-color: #b8d4ff;
      background: #eef5ff;
    }

    .assistant-message,
    .approval-message {
      justify-self: start;
    }

    .approval-message {
      border-color: #f5c2bd;
      background: #fff7f5;
    }

    .chat-message-role {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }

    .chat-message-content {
      min-width: 0;
      color: var(--text);
      font-size: 14px;
      line-height: 1.55;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .chat-composer-dock {
      display: grid;
      gap: 10px;
      border-top: 1px solid var(--border);
      background: white;
      padding: 14px;
    }

    .chat-composer-dock textarea {
      min-height: 78px;
      max-height: 180px;
      resize: vertical;
    }

    .preview-drawer {
      position: fixed;
      top: 24px;
      right: 24px;
      bottom: 24px;
      z-index: 20;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      width: min(420px, calc(100vw - 32px));
      transform: translateX(calc(100% + 40px));
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: transform 160ms ease, opacity 160ms ease;
    }

    .preview-drawer.is-open {
      transform: translateX(0);
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
    }

    .preview-drawer .preview-frame {
      min-height: 0;
      height: 100%;
      background:
        linear-gradient(90deg, rgb(15 23 42 / 0.04) 1px, transparent 1px),
        linear-gradient(rgb(15 23 42 / 0.04) 1px, transparent 1px),
        #fbfcfe;
      background-size: 24px 24px;
    }

    .empty-list-row {
      color: var(--muted);
      list-style: none;
    }

    .confirmation-card {
      display: grid;
      gap: 6px;
    }

    .assistant-ui-shell-page {
      width: min(1220px, calc(100% - 32px));
    }

    .assistant-ui-surface {
      overflow: hidden;
      padding: 0;
    }

    .assistant-ui-runtime-shell {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      min-height: 620px;
      background: white;
    }

    .assistant-ui-thread-rail {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 14px;
      min-width: 0;
      border-right: 1px solid var(--border);
      background: #f8fafc;
      padding: 18px;
    }

    .assistant-ui-rail-header p,
    .assistant-ui-kicker {
      color: var(--teal);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .assistant-ui-new-thread {
      width: 100%;
    }

    .assistant-ui-thread-list,
    .assistant-ui-message-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .assistant-ui-thread-list {
      display: grid;
      align-content: start;
      gap: 8px;
      overflow: auto;
    }

    .assistant-ui-thread-list-item {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: white;
      color: var(--ink);
      padding: 12px;
      font-size: 13px;
      font-weight: 750;
      overflow-wrap: anywhere;
    }

    .assistant-ui-thread-list-item[aria-current="true"] {
      border-color: #8dc8bf;
      background: #eef8f6;
      box-shadow: inset 3px 0 0 var(--teal);
    }

    .assistant-ui-thread-switch {
      width: 100%;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .assistant-ui-thread-panel {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-width: 0;
      min-height: 0;
      background: #fbfcfe;
    }

    .assistant-ui-thread-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid var(--border);
      background: white;
      padding: 18px 20px;
    }

    .assistant-ui-thread-header h2 {
      margin-top: 4px;
      font-size: 18px;
    }

    .assistant-ui-message-list {
      display: grid;
      align-content: start;
      gap: 14px;
      min-height: 0;
      overflow: auto;
      padding: 22px;
    }

    .assistant-ui-message {
      display: grid;
      gap: 6px;
      width: min(760px, 92%);
      border: 1px solid var(--border);
      border-radius: 8px;
      background: white;
      color: var(--ink);
      padding: 12px 14px;
      box-shadow: 0 10px 24px rgb(16 24 40 / 0.06);
    }

    .assistant-ui-message-user {
      justify-self: end;
      border-color: #b8d4ff;
      background: #eef5ff;
    }

    .assistant-ui-message-assistant,
    .assistant-ui-message-system {
      justify-self: start;
    }

    .assistant-ui-message-loading {
      border-style: dashed;
      background: #f7fbfa;
    }

    .assistant-ui-message-role {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }

    .assistant-ui-message-content {
      min-width: 0;
      color: var(--text);
      font-size: 14px;
      line-height: 1.55;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .assistant-ui-message-loading .assistant-ui-message-content {
      color: var(--muted);
    }

    .assistant-ui-composer {
      display: grid;
      gap: 10px;
      border-top: 1px solid var(--border);
      background: white;
      padding: 14px;
    }

    .assistant-ui-composer textarea {
      min-height: 76px;
      max-height: 180px;
      resize: vertical;
      background: #fbfcfe;
      line-height: 1.5;
    }

    .assistant-ui-composer-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    @media (max-width: 760px) {
      .app-shell {
        width: min(100% - 24px, 1080px);
        padding: 20px 0;
      }

      .topbar,
      .workspace-grid,
      .composer-grid,
      .agent-console-grid {
        grid-template-columns: 1fr;
      }

      .topbar {
        display: grid;
      }

      h1 {
        font-size: 26px;
      }

      .status-cluster,
      .composer-actions {
        justify-content: stretch;
      }

      .composer-actions {
        display: grid;
      }

      .share-link-edit-form {
        grid-template-columns: 1fr;
      }

      .agent-preview-panel .preview-frame {
        min-height: 260px;
      }

      .thread-event {
        grid-template-columns: 1fr;
        gap: 4px;
      }

      .friend-chat-shell {
        width: min(100% - 20px, 1080px);
        grid-template-columns: 1fr;
        min-height: auto;
      }

      .friend-session-sidebar {
        grid-template-rows: auto auto auto;
      }

      .session-list {
        grid-auto-flow: column;
        grid-auto-columns: minmax(180px, 72vw);
        overflow-x: auto;
      }

      .friend-chat-topbar,
      .friend-chat-topbar .status-cluster {
        display: grid;
        justify-content: stretch;
      }

      .chat-thread {
        min-height: 420px;
        max-height: none;
        padding: 14px;
      }

      .chat-message {
        width: 100%;
      }

      .preview-drawer {
        inset: 0;
        width: auto;
        border-radius: 0;
        transform: translateY(100%);
      }

      .preview-drawer.is-open {
        transform: translateY(0);
      }

      .assistant-ui-runtime-shell {
        grid-template-columns: 1fr;
        min-height: auto;
      }

      .assistant-ui-thread-rail {
        grid-template-rows: auto auto auto;
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }

      .assistant-ui-thread-list {
        grid-auto-flow: column;
        grid-auto-columns: minmax(180px, 72vw);
        overflow-x: auto;
      }

      .assistant-ui-thread-header {
        display: grid;
        align-items: stretch;
      }

      .assistant-ui-composer-actions {
        display: grid;
        align-items: stretch;
      }

      .assistant-ui-message-list {
        padding: 14px;
      }

      .assistant-ui-message {
        width: 100%;
      }
    }
  `;
}

function originFor(request: IncomingMessage): string {
  return `http://${request.headers.host ?? "127.0.0.1"}`;
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

function stringField(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalStringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function runtimeEventsField(value: unknown): RuntimeEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is RuntimeEvent => {
    return Boolean(entry)
      && typeof entry === "object"
      && typeof (entry as { type?: unknown }).type === "string"
      && typeof (entry as { taskId?: unknown }).taskId === "string";
  });
}

function authenticateHostRequest(input: {
  store: RelayStore;
  hostId: string;
  providedKey: string;
  action: string;
}): { ok: true } | { ok: false; status: number; body: { error: string } } {
  if (!input.providedKey) {
    return { ok: false, status: 401, body: { error: "host_auth_required" } };
  }

  const host = input.store.findHost(input.hostId);
  if (!host) {
    return { ok: false, status: 404, body: { error: "host_not_found" } };
  }

  if (!host.deviceKeyHash || hashDeviceKey(input.providedKey) !== host.deviceKeyHash) {
    input.store.appendAuditLog({
      ownerId: host.ownerId,
      actorType: "host",
      eventType: "host.auth_failed",
      summary: `${host.deviceName} ${input.action} auth failed`,
      metadata: { hostId: input.hostId, reason: "invalid_device_key" },
    });
    return { ok: false, status: 403, body: { error: "host_auth_invalid" } };
  }

  return { ok: true };
}

function approvalStatusField(value: string | null): ApprovalRequestRecord["status"] | undefined {
  if (value === "pending" || value === "approved" || value === "denied" || value === "expired") {
    return value;
  }

  return undefined;
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

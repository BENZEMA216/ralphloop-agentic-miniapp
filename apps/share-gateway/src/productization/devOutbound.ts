import { pathToFileURL } from "node:url";

import { AdapterRegistry } from "../adapters/registry.ts";
import { createDevAdapterMap, type DevAdapterMode, supportedDevAdapterIds } from "./devRuntime.ts";
import { createHostClientRuntimeState, runHostCommandOnce } from "./hostClient.ts";
import { createProductizedShareServer } from "./httpServer.ts";
import { RelayStore } from "./relayStore.ts";

type ProductizedFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

type OutboundDevServer = {
  baseUrl: string;
  ownerUrl: string;
  friendUrl: string;
  fetch: ProductizedFetch;
  runOnce(): Promise<number>;
  heartbeatOnce(): Promise<Response>;
  close(): Promise<void>;
};

export async function startOutboundDevServer(input: {
  port?: number;
  adapterMode?: DevAdapterMode;
  bootstrapSecret?: string;
  token?: string;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  adapterIds?: string[];
} = {}): Promise<OutboundDevServer> {
  const port = input.port ?? Number(process.env.PORT ?? 5181);
  const adapterMode = input.adapterMode ?? (process.env.RALPHLOOP_ADAPTER_MODE === "real" ? "real" : "demo");
  const bootstrapSecret = input.bootstrapSecret
    ?? process.env.RALPHLOOP_HOST_BOOTSTRAP_SECRET
    ?? "ralphloop-local-bootstrap-secret";
  const token = input.token ?? "local-friend";
  const detectedAdapters = input.adapterIds
    ? []
    : await new AdapterRegistry().detectAll();
  const supportedAdapters = input.adapterIds ?? supportedDevAdapterIds(detectedAdapters);
  const store = new RelayStore();
  const tokenFactory = createLocalTokenFactory(token);
  const server = createProductizedShareServer({
    store,
    tokenFactory,
    hostBootstrapSecret: bootstrapSecret,
  });

  await server.listen(port);
  const baseUrl = server.url();

  const registered = await server.fetch(`${baseUrl}/v1/hosts/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ralphloop-bootstrap-secret": bootstrapSecret,
    },
    body: JSON.stringify({
      ownerId: "owner-1",
      hostId: "host-1",
      deviceName: "Local Ralphloop Outbound Host",
      hostVersion: "0.2.0",
      supportedAdapters,
      capabilities: ["outbound_commands"],
    }),
  });
  if (registered.status !== 201) {
    throw new Error(`Failed to register outbound dev host: ${registered.status} ${await registered.text()}`);
  }
  const registeredBody = await registered.json() as { deviceKey: string };

  const created = await server.fetch(`${baseUrl}/v1/owner/share-links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerId: "owner-1",
      hostId: "host-1",
      name: "Ralphloop Outbound Agent",
    }),
  });
  if (created.status !== 201) {
    throw new Error(`Failed to create outbound dev share link: ${created.status} ${await created.text()}`);
  }

  const adapters = createDevAdapterMap({
    adapterIds: supportedAdapters,
    mode: adapterMode,
  });
  const runtimeState = createHostClientRuntimeState();
  const runOnce = () => runHostCommandOnce({
    relayBaseUrl: baseUrl,
    hostId: "host-1",
    deviceKey: registeredBody.deviceKey,
    adapters,
    fetch: server.fetch,
    runtimeState,
  });
  const heartbeatOnce = () => server.fetch(`${baseUrl}/v1/hosts/host-1/heartbeat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ralphloop-device-key": registeredBody.deviceKey,
    },
    body: JSON.stringify({
      supportedAdapters,
      capabilities: ["outbound_commands"],
    }),
  });

  const pollIntervalMs = input.pollIntervalMs ?? 500;
  const interval = pollIntervalMs > 0
    ? setInterval(() => {
      void runOnce().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
      });
    }, pollIntervalMs)
    : undefined;
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? 10_000;
  const heartbeatInterval = heartbeatIntervalMs > 0
    ? setInterval(() => {
      void heartbeatOnce().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
      });
    }, heartbeatIntervalMs)
    : undefined;

  return {
    baseUrl,
    ownerUrl: `${baseUrl}/app/owner`,
    friendUrl: `${baseUrl}/app/share/${token}/assistant-ui`,
    fetch: server.fetch,
    runOnce,
    heartbeatOnce,
    async close() {
      if (interval) {
        clearInterval(interval);
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      await server.close();
    },
  };
}

function createLocalTokenFactory(seedToken: string): () => string {
  let next = 0;
  return () => {
    if (next === 0) {
      next += 1;
      return seedToken;
    }
    next += 1;
    return `${seedToken}-${next}`;
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dev = await startOutboundDevServer();
  console.log(`ralphloop outbound relay listening on ${dev.ownerUrl}`);
  console.log(`friend link: ${dev.friendUrl}`);
  console.log("host transport: HTTP outbound command polling");
}

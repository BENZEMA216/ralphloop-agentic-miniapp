import { AdapterRegistry } from "../adapters/registry.ts";
import { createDevAdapterMap, supportedDevAdapterIds } from "./devRuntime.ts";
import { HostRuntimeRegistry } from "./hostRuntime.ts";
import { createProductizedShareServer } from "./httpServer.ts";
import { RelayStore } from "./relayStore.ts";

const port = Number(process.env.PORT ?? 5180);
const adapterMode = process.env.RALPHLOOP_ADAPTER_MODE === "real" ? "real" : "demo";
const bootstrapSecret = process.env.RALPHLOOP_HOST_BOOTSTRAP_SECRET ?? "ralphloop-local-bootstrap-secret";
const store = new RelayStore();
const runtimes = new HostRuntimeRegistry();
const detectedAdapters = await new AdapterRegistry().detectAll();
const supportedAdapters = supportedDevAdapterIds(detectedAdapters);
const tokenFactory = createLocalTokenFactory("local-friend");

const server = createProductizedShareServer({
  store,
  runtimes,
  tokenFactory,
  hostBootstrapSecret: bootstrapSecret,
});

await server.listen(port);

const baseUrl = server.url();
const registerResponse = await server.fetch(`${baseUrl}/v1/hosts/register`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-ralphloop-bootstrap-secret": bootstrapSecret,
  },
  body: JSON.stringify({
    ownerId: "owner-1",
    hostId: "host-1",
    deviceName: "Local Ralphloop Host",
    hostVersion: "0.1.0",
    supportedAdapters,
  }),
});
if (registerResponse.status !== 201) {
  throw new Error(`Failed to register dev host: ${registerResponse.status} ${await registerResponse.text()}`);
}
const { deviceKey } = (await registerResponse.json()) as { deviceKey: string };

runtimes.connectHost({
  hostId: "host-1",
  adapters: createDevAdapterMap({
    adapterIds: supportedAdapters,
    mode: adapterMode,
  }),
});

await server.fetch(`${baseUrl}/v1/hosts/host-1/heartbeat`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-ralphloop-device-key": deviceKey,
  },
  body: JSON.stringify({ supportedAdapters }),
});

console.log(`ralphloop productized server listening on ${baseUrl}/app/owner`);
console.log(`adapter mode: ${adapterMode}; adapters: ${supportedAdapters.join(", ")}`);

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

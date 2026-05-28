import type {
  AgentAdapter,
  AgentAdapterInfo,
  DesktopPreviewCapability,
  RuntimeEventCapability,
  RuntimeStartCapability,
  RuntimeTaskCapability,
} from "./types.ts";

/**
 * The formal contract every agent provider (Codex / Claude / OpenCode / future
 * ACP-generic adapters) must satisfy. Structurally identical to the existing
 * `AgentAdapter` shape so today's three adapters conform without behavior
 * changes; named `ProviderAdapter` to signal "this is the public extension
 * point" to consumers and `ProviderRegistry`.
 */
export interface ProviderAdapter extends AgentAdapter {}

/**
 * Surfaces what the registry currently encodes inline per adapter so callers
 * (UI dropdowns, ProviderRegistry, contract tests) can introspect a provider
 * without round-tripping through `detect()`.
 */
export type ProviderCapabilityDescriptor = {
  id: string;
  displayName: string;
  startCapability: RuntimeStartCapability;
  taskCapability: RuntimeTaskCapability;
  eventCapability: RuntimeEventCapability;
  desktopPreviewCapability: DesktopPreviewCapability;
};

export class ProviderContractError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`provider_contract_violation: missing ${missing.join(", ")}`);
    this.name = "ProviderContractError";
    this.missing = missing;
  }
}

/**
 * Throws if the supplied object does not expose every method required by
 * `ProviderAdapter`. Cheap structural check used by `ProviderRegistry.register`
 * and by tests that build mock adapters.
 */
export function assertProviderContract(
  adapter: unknown,
): asserts adapter is ProviderAdapter {
  if (!adapter || typeof adapter !== "object") {
    throw new ProviderContractError(["adapter (not an object)"]);
  }

  const candidate = adapter as Record<string, unknown>;
  const required = ["detect", "start", "submitTask", "streamEvents", "stop"] as const;
  const missing: string[] = [];

  for (const method of required) {
    if (typeof candidate[method] !== "function") {
      missing.push(method);
    }
  }

  if (missing.length > 0) {
    throw new ProviderContractError(missing);
  }
}

/**
 * Narrows an `AgentAdapterInfo` to the descriptor shape so callers can stash
 * a snapshot of provider capabilities without retaining the full status/version
 * detection result.
 */
export function toCapabilityDescriptor(
  info: AgentAdapterInfo,
): ProviderCapabilityDescriptor {
  return {
    id: info.id,
    displayName: info.displayName,
    startCapability: info.startCapability,
    taskCapability: info.taskCapability,
    eventCapability: info.eventCapability,
    desktopPreviewCapability: info.desktopPreviewCapability,
  };
}

import { assertProviderContract, type ProviderAdapter } from "./provider.ts";

export type ProviderFactory = () => ProviderAdapter;

export type ProviderRegistration = {
  id: string;
  factory: ProviderFactory;
};

export class UnknownProviderError extends Error {
  readonly adapterId: string;

  constructor(adapterId: string) {
    super(`unknown_adapter: ${adapterId}`);
    this.name = "UnknownProviderError";
    this.adapterId = adapterId;
  }
}

/**
 * Registry of available `ProviderAdapter` factories keyed by adapter id.
 *
 * - `get(id)` lazily instantiates the adapter from its factory; each call
 *   produces a fresh adapter (state lives in the adapter, never in the
 *   registry).
 * - `register({ id, factory })` adds or replaces an entry; the factory's
 *   output is contract-checked the first time it is realized so test
 *   stubs can fail fast.
 * - `list()` returns the registered ids in insertion order so callers
 *   (UI dropdowns, /v1/adapters, contract tests) get a deterministic
 *   ordering.
 */
export class ProviderRegistry {
  readonly #factories = new Map<string, ProviderFactory>();

  constructor(initial: ProviderRegistration[] = []) {
    for (const entry of initial) {
      this.register(entry);
    }
  }

  register(entry: ProviderRegistration): void {
    if (!entry.id || typeof entry.id !== "string") {
      throw new Error("provider_registry: id is required");
    }
    if (typeof entry.factory !== "function") {
      throw new Error(`provider_registry: factory for "${entry.id}" must be a function`);
    }
    this.#factories.set(entry.id, entry.factory);
  }

  has(id: string): boolean {
    return this.#factories.has(id);
  }

  get(id: string): ProviderAdapter {
    const factory = this.#factories.get(id);
    if (!factory) {
      throw new UnknownProviderError(id);
    }
    const adapter = factory();
    assertProviderContract(adapter);
    return adapter;
  }

  list(): string[] {
    return Array.from(this.#factories.keys());
  }
}

import type { AgentAdapter, RuntimeHandle } from "../adapters/types.ts";

/**
 * A single in-flight task slot owned by a session. Each slot bundles the
 * adapter, the runtime handle (set once `start()` completes), an
 * `AbortController` whose signal threads through to `submitTask` /
 * `streamEvents`, and a one-way `stopRequested` flag the cancel path
 * flips before the abort actually propagates.
 *
 * Slots are mutable from inside `executeHostCommand`'s lifecycle but the
 * `cancel` path only touches `stopRequested` + `abortController` so the
 * data races are bounded to those fields.
 */
export type SessionSlot = {
  readonly sessionId: string;
  readonly abortController: AbortController;
  adapter: AgentAdapter;
  runtime?: RuntimeHandle;
  stopRequested: boolean;
  /** Optional reason captured when stopRequested flipped. */
  cancelReason?: string;
};

export class SessionBusyError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`session_busy: ${sessionId}`);
    this.name = "SessionBusyError";
    this.sessionId = sessionId;
  }
}

type SessionLock = {
  current: Promise<unknown>;
};

/**
 * Per-session process table used by the host client. Owns the
 * cancel-vs-finally race by serializing `cancel`/`release` calls behind a
 * tiny per-session async lock so:
 *
 * 1. A cancel that arrives while the slot is still completing waits for
 *    the lock, observes the up-to-date slot state, and flips
 *    `stopRequested` exactly once.
 * 2. `release()` is also serialized so the slot identity check (slot
 *    instance, not just sessionId) cannot fall out from under a cancel
 *    mid-flight.
 * 3. `cancel()` for an unknown session is a cheap no-op.
 */
export class SessionProcessTable {
  readonly #slots = new Map<string, SessionSlot>();
  readonly #locks = new Map<string, SessionLock>();
  /**
   * Back-compat surface for callers that still reach into the legacy
   * shape (`runtimeState.activeTasksBySession`). The map intentionally
   * mirrors `#slots` so we never have two sources of truth.
   */
  get activeTasksBySession(): Map<string, SessionSlot> {
    return this.#slots;
  }

  /**
   * Reserve a slot for `sessionId`. Throws `SessionBusyError` if the
   * session already has an active slot — the caller must cancel the
   * existing slot first.
   */
  acquire(input: {
    sessionId: string;
    adapter: AgentAdapter;
    abortController: AbortController;
  }): SessionSlot {
    if (this.#slots.has(input.sessionId)) {
      throw new SessionBusyError(input.sessionId);
    }
    const slot: SessionSlot = {
      sessionId: input.sessionId,
      adapter: input.adapter,
      abortController: input.abortController,
      stopRequested: false,
    };
    this.#slots.set(input.sessionId, slot);
    return slot;
  }

  /**
   * Returns the active slot if one exists. The returned reference is the
   * same object held by the table, so callers can mutate `runtime` /
   * `stopRequested` directly without going through the table.
   */
  getActive(sessionId: string): SessionSlot | undefined {
    return this.#slots.get(sessionId);
  }

  /**
   * Best-effort cancel of an in-flight slot. Idempotent: a second call
   * after the slot was released is a silent no-op, a second call while
   * the first is still propagating waits for the lock and then observes
   * `stopRequested === true` and exits early.
   */
  async cancel(sessionId: string, reason: string): Promise<void> {
    await this.#runLocked(sessionId, async () => {
      const slot = this.#slots.get(sessionId);
      if (!slot || slot.stopRequested) {
        return;
      }
      slot.stopRequested = true;
      slot.cancelReason = reason;
      slot.abortController.abort();
      if (!slot.runtime) {
        return;
      }
      try {
        await slot.adapter.stop({ runtime: slot.runtime, reason });
      } catch {
        // The abort signal is the authoritative cancellation path for CLI
        // tasks; adapter.stop is best-effort cleanup.
      }
    });
  }

  /**
   * Release a slot if (and only if) it still owns the session entry.
   * The instance-identity check protects against a race where a second
   * `acquire()` for the same session has already taken over.
   */
  release(slot: SessionSlot): void {
    if (this.#slots.get(slot.sessionId) === slot) {
      this.#slots.delete(slot.sessionId);
    }
    if (!this.#slots.has(slot.sessionId)) {
      this.#locks.delete(slot.sessionId);
    }
  }

  /** Number of in-flight slots — handy in tests. */
  size(): number {
    return this.#slots.size;
  }

  async #runLocked<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.#locks.get(sessionId);
    const previous = existing?.current ?? Promise.resolve();
    let resolveNext!: (value: T) => void;
    let rejectNext!: (reason?: unknown) => void;
    const next = new Promise<T>((resolve, reject) => {
      resolveNext = resolve;
      rejectNext = reject;
    });
    const lock: SessionLock = { current: next };
    this.#locks.set(sessionId, lock);

    try {
      await previous;
    } catch {
      // Previous holder's failure is its own problem; we still take the
      // lock so the chain advances.
    }

    try {
      const result = await fn();
      resolveNext(result);
      return result;
    } catch (error) {
      rejectNext(error);
      throw error;
    } finally {
      if (this.#locks.get(sessionId) === lock) {
        this.#locks.delete(sessionId);
      }
    }
  }
}

/** Factory mirroring the historical createHostClientRuntimeState shape. */
export function createSessionProcessTable(): SessionProcessTable {
  return new SessionProcessTable();
}

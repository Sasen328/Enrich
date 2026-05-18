/**
 * Bounded, LRU-style job-emitter registry.
 *
 * Each engine (Lead Factory, Signal Monitor, Masar Harvester, Relationship
 * Intel) used to maintain its own `Map<jobId, EventEmitter>` with a 4-hour
 * `setTimeout` cleanup. Under sustained load that was a leak: nothing
 * bounded the live size, so a flood of cancelled or never-streamed jobs
 * could hold memory until the timeout fired.
 *
 * This module replaces all of those with one shared, capped registry per
 * engine. When the cap is hit, the oldest entry is evicted first.
 */
import { EventEmitter } from "events";

export interface JobRegistryOptions {
  /** Hard upper bound on simultaneously-tracked jobs. Oldest is evicted first. */
  maxEntries?: number;
  /** Max time a job is retained even if active. Defaults to 4 hours. */
  ttlMs?: number;
  /** EventEmitter max listeners; default 20. */
  maxListeners?: number;
  /** Short prefix for generated job IDs. */
  idPrefix: string;
}

export class JobRegistry {
  private readonly emitters = new Map<string, EventEmitter>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly maxListeners: number;
  private readonly idPrefix: string;

  constructor(opts: JobRegistryOptions) {
    this.maxEntries = opts.maxEntries ?? 200;
    this.ttlMs = opts.ttlMs ?? 4 * 60 * 60 * 1000;
    this.maxListeners = opts.maxListeners ?? 20;
    this.idPrefix = opts.idPrefix;
  }

  /** Create a new job, return its id + emitter. */
  create(): { jobId: string; emitter: EventEmitter } {
    // Evict oldest entries until we have headroom.
    while (this.emitters.size >= this.maxEntries) {
      const oldest = this.emitters.keys().next().value;
      if (!oldest) break;
      this.delete(oldest);
    }

    const jobId = `${this.idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const emitter = new EventEmitter();
    emitter.setMaxListeners(this.maxListeners);
    this.emitters.set(jobId, emitter);
    this.aborts.set(jobId, new AbortController());

    const timer = setTimeout(() => this.delete(jobId), this.ttlMs);
    // Don't keep the event loop alive solely for cleanup timers.
    timer.unref?.();
    this.timers.set(jobId, timer);

    return { jobId, emitter };
  }

  /**
   * Returns the AbortSignal for a job. Engines should pass this into fetch /
   * axios calls and check it between agents so cancellation actually stops work.
   */
  getSignal(jobId: string): AbortSignal | undefined {
    return this.aborts.get(jobId)?.signal;
  }

  /**
   * Signal cancellation. The corresponding emitter receives a final
   * "cancelled" event then `done`. Engines that polled `getSignal()` see
   * `signal.aborted === true` and short-circuit.
   */
  cancel(jobId: string, reason: string = "cancelled by user"): boolean {
    const ctrl = this.aborts.get(jobId);
    const emitter = this.emitters.get(jobId);
    if (!ctrl || !emitter) return false;
    if (ctrl.signal.aborted) return false; // already cancelled
    ctrl.abort();
    emitter.emit("event", { type: "cancelled", reason });
    emitter.emit("done");
    return true;
  }

  /**
   * Register an externally-generated jobId. Used by engines that mint job IDs
   * upstream (e.g. masar-harvester takes the id as a parameter).
   */
  attach(jobId: string): EventEmitter {
    while (this.emitters.size >= this.maxEntries) {
      const oldest = this.emitters.keys().next().value;
      if (!oldest) break;
      this.delete(oldest);
    }
    const emitter = new EventEmitter();
    emitter.setMaxListeners(this.maxListeners);
    this.emitters.set(jobId, emitter);
    const timer = setTimeout(() => this.delete(jobId), this.ttlMs);
    timer.unref?.();
    this.timers.set(jobId, timer);
    return emitter;
  }

  /** Lookup. */
  get(jobId: string): EventEmitter | undefined {
    return this.emitters.get(jobId);
  }

  /** Manual eviction (call when a job ends so memory is reclaimed promptly). */
  delete(jobId: string): void {
    const timer = this.timers.get(jobId);
    if (timer) clearTimeout(timer);
    this.timers.delete(jobId);
    const emitter = this.emitters.get(jobId);
    if (emitter) emitter.removeAllListeners();
    this.emitters.delete(jobId);
    this.aborts.delete(jobId);
  }

  size(): number {
    return this.emitters.size;
  }
}

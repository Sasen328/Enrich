/**
 * In-process event bus — powers the live Dashboard stream (§10/§16).
 *
 * Engines publish lifecycle events (job started, lead saved, enrichment done)
 * and the dashboard SSE stream pushes them to connected clients immediately,
 * instead of waiting for the 5s snapshot poll. A bounded ring buffer keeps the
 * last N events so a freshly-connected client can render recent activity at
 * once. Process-local (no Redis) — fine for a single API node.
 */

import { EventEmitter } from "node:events";

export interface AppEvent {
  /** Short machine kind, e.g. "swarm.start", "lead.saved", "masaar.complete". */
  kind: string;
  /** Emoji/icon hint for the activity feed. */
  ico?: string;
  /** Human-readable line for the activity feed. */
  text: string;
  /** Originating engine, e.g. "swarm", "lead-factory", "masaar". */
  source?: string;
  /** Epoch ms; defaulted on publish. */
  ts?: number;
}

const RING_SIZE = 100;
const ring: AppEvent[] = [];
const emitter = new EventEmitter();
// Many SSE clients may subscribe concurrently; lift the default cap.
emitter.setMaxListeners(0);

/** Publish an event: append to the ring buffer and notify subscribers. */
export function publishEvent(evt: AppEvent): void {
  const full: AppEvent = { ...evt, ts: evt.ts ?? Date.now() };
  ring.push(full);
  if (ring.length > RING_SIZE) ring.shift();
  emitter.emit("event", full);
}

/** Subscribe to live events. Returns an unsubscribe function. */
export function subscribeEvents(cb: (evt: AppEvent) => void): () => void {
  emitter.on("event", cb);
  return () => emitter.off("event", cb);
}

/** Most recent events, newest first. */
export function recentEvents(n = 8): AppEvent[] {
  return ring.slice(-n).reverse();
}

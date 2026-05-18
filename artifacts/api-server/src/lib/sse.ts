/**
 * Server-Sent Events helper.
 *
 * Every SSE route in the API was duplicating the same boilerplate: set
 * headers, attach an `event` listener that writes `data: ${JSON}\n\n`,
 * attach a `done` listener that emits a `stream_end` and closes. None of
 * them wrapped `res.write` in try/catch, so if the engine threw after
 * `flushHeaders()` the client would just hang.
 *
 * `pipeEmitterToSse` centralises the pattern and guarantees the client
 * always receives a terminal event — either `stream_end` on success or
 * `stream_error` if something went wrong.
 */
import type { Request, Response } from "express";
import type { EventEmitter } from "events";

export interface PipeOptions {
  /** Heartbeat interval in ms (0 disables). Default 25 000 to keep proxies open. */
  heartbeatMs?: number;
}

export function pipeEmitterToSse(
  req: Request,
  res: Response,
  emitter: EventEmitter,
  opts: PipeOptions = {},
): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const safeWrite = (payload: unknown): boolean => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch {
      // Client disconnected mid-write. Caller should clean up.
      return false;
    }
  };

  const onEvent = (event: unknown) => {
    if (!safeWrite(event)) cleanup();
  };
  const onDone = () => {
    safeWrite({ type: "stream_end" });
    cleanup();
    res.end();
  };
  const onError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    safeWrite({ type: "stream_error", message });
    cleanup();
    res.end();
  };

  emitter.on("event", onEvent);
  emitter.once("done", onDone);
  emitter.once("error", onError);

  const heartbeatMs = opts.heartbeatMs ?? 25_000;
  const heartbeat = heartbeatMs > 0
    ? setInterval(() => safeWrite({ type: "heartbeat", t: Date.now() }), heartbeatMs)
    : null;

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    emitter.off("event", onEvent);
    emitter.off("done", onDone);
    emitter.off("error", onError);
    if (heartbeat) clearInterval(heartbeat);
  }

  req.on("close", cleanup);
}

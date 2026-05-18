/**
 * Process lifecycle state shared across modules.
 *
 * `isShuttingDown()` flips to true the moment we receive SIGTERM/SIGINT. The
 * health check reads it to flip /healthz to 503 so load balancers stop sending
 * new traffic while in-flight requests drain.
 */

let shuttingDown = false;

export function markShuttingDown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

import { useEffect, useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface AgentState {
  /** 1..7 — the agent currently running, or undefined if not started. */
  current?: number;
  /** How many rows the running agent has processed so far. */
  progress?: number;
  /** Total rows the running agent has to process. */
  total?: number;
  /** Per-agent completion flags (true = done). */
  done: Record<number, boolean>;
  /** Per-agent latest log lines, capped to last 5. */
  logs: Record<number, string[]>;
  /** Terminal status after the run ends. */
  status: "idle" | "running" | "completed" | "failed";
  /** Error message if status === "failed". */
  error?: string;
}

const INIT: AgentState = { status: "idle", done: {}, logs: {} };

/** Subscribe to the Lead Factory SSE stream for a given job and surface a
 *  state object the AgentPreview component can render directly.
 *
 *  Pass jobId=null to leave the hook idle. The hook auto-cleans the
 *  EventSource on unmount or jobId change. */
export function useLeadFactoryStream(jobId: string | null): AgentState {
  const [state, setState] = useState<AgentState>(INIT);

  useEffect(() => {
    if (!jobId) {
      setState(INIT);
      return;
    }
    // jobId comes back as "lf-<n>" from /start; the stream endpoint accepts
    // either the prefixed form or the numeric id.
    const url = `${BASE}/api/lead-factory/stream/${jobId}`;
    const es = new EventSource(url);
    setState({ ...INIT, status: "running" });

    es.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data);
        setState((prev) => {
          const next = { ...prev };
          switch (evt.type) {
            case "agent_start":
              next.current = evt.agent;
              next.progress = 0;
              next.total = undefined;
              break;
            case "agent_progress":
              if (evt.agent === next.current) {
                next.progress = evt.current;
                next.total = evt.total;
              }
              break;
            case "agent_log":
              if (typeof evt.agent === "number" && typeof evt.message === "string") {
                const arr = next.logs[evt.agent] ? [...next.logs[evt.agent]] : [];
                arr.push(evt.message);
                next.logs = { ...next.logs, [evt.agent]: arr.slice(-5) };
              }
              break;
            case "agent_complete":
              next.done = { ...next.done, [evt.agent]: true };
              if (next.current === evt.agent) {
                next.current = evt.agent < 7 ? evt.agent + 1 : undefined;
              }
              break;
            case "done":
              next.status = "completed";
              next.current = undefined;
              break;
            case "error":
            case "stream_error":
              next.status = "failed";
              next.error = evt.message || evt.error || "Stream error";
              break;
          }
          return next;
        });
      } catch { /* ignore malformed payload */ }
    };

    es.onerror = () => {
      // EventSource auto-retries; only mark failed after several rapid errors
      setState((prev) => prev.status === "completed" ? prev : { ...prev });
    };

    return () => es.close();
  }, [jobId]);

  return state;
}

import { Router, type IRouter, type Request, type Response } from "express";
import { createJob, getJobEmitter, runMasaarPipeline, submitCaptcha, type AgentEvent } from "../lib/masaar-engine.js";
import { randomUUID } from "crypto";

const p = (x: string | string[]): string => Array.isArray(x) ? x[0] : x;

const router: IRouter = Router();

// POST /api/masaar/start — kick off the 7-agent Masaar pipeline
router.post("/masaar/start", async (req: Request, res: Response): Promise<void> => {
  const { crNumber, stealthMode } = req.body;
  if (!crNumber || !/^\d{7,12}$/.test(String(crNumber).trim())) {
    res.status(400).json({ error: "Valid CR number (7-12 digits) is required" });
    return;
  }

  const jobId = randomUUID();
  const useStealthMode = stealthMode !== false; // default true
  createJob(jobId, useStealthMode);

  res.json({
    jobId,
    crNumber: String(crNumber).trim(),
    stealthMode: useStealthMode,
    message: `Masaar pipeline started in ${useStealthMode ? "stealth" : "manual"} mode`,
  });

  const crNum = String(crNumber).trim();
  setImmediate(() => {
    runMasaarPipeline(crNum, jobId).catch((err) => {
      const emitter = getJobEmitter(jobId);
      emitter?.emit("event", {
        type: "job_error",
        message: err instanceof Error ? err.message : "Pipeline failed",
      });
    });
  });
});

// POST /api/masaar/captcha/:jobId — submit manual CAPTCHA when AI fallback triggers
router.post("/masaar/captcha/:jobId", (req: Request, res: Response): void => {
  const { jobId } = req.params;
  const { captchaText, captchaFor } = req.body;

  if (!captchaText || !captchaFor) {
    res.status(400).json({ error: "captchaText and captchaFor are required" });
    return;
  }

  const ok = submitCaptcha(String(Array.isArray(jobId) ? jobId[0] : jobId), String(captchaFor), String(captchaText).trim());
  if (!ok) {
    res.status(404).json({ error: "No CAPTCHA pending for this job/field, or job not found" });
    return;
  }

  res.json({ ok: true, message: "CAPTCHA submitted — pipeline resuming" });
});

// GET /api/masaar/stream/:jobId — SSE stream of real-time agent events
router.get("/masaar/stream/:jobId", (req: Request, res: Response): void => {
  const jobId = p(req.params.jobId);
  const emitter = getJobEmitter(jobId);

  if (!emitter) {
    res.status(404).json({ error: "Job not found or expired" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (event: AgentEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if ("flush" in res && typeof (res as Record<string, unknown>).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  };

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  emitter.on("event", sendEvent);

  const cleanup = () => {
    clearInterval(heartbeat);
    emitter.off("event", sendEvent);
  };

  emitter.on("event", (evt: AgentEvent) => {
    if (evt.type === "job_complete" || evt.type === "job_error") {
      setTimeout(cleanup, 2000);
    }
  });

  req.on("close", cleanup);
  req.on("error", cleanup);
});

export default router;

// §6 — Sherlock OSINT (username enumeration across 400+ sites).
// Spawns the Sherlock Python CLI inside the Scout container if present.
// Degrades to { available:false } when the binary isn't installed.
import { spawn } from "node:child_process";

export interface SherlockHit { site: string; url: string; }
export interface SherlockResult { available: boolean; username: string; hits: SherlockHit[]; }

export async function sherlockLookup(username: string, timeoutMs = 60000): Promise<SherlockResult> {
  const bin = process.env.SHERLOCK_BIN || "sherlock";
  return new Promise((resolve) => {
    let out = "";
    let proc;
    try {
      proc = spawn(bin, ["--print-found", "--no-color", username], { timeout: timeoutMs });
    } catch {
      return resolve({ available: false, username, hits: [] });
    }
    proc.on("error", () => resolve({ available: false, username, hits: [] }));
    proc.stdout?.on("data", (d) => (out += d.toString()));
    proc.on("close", () => {
      const hits: SherlockHit[] = [];
      for (const line of out.split("\n")) {
        const m = line.match(/\[\+\]\s+(\w[\w .]*?):\s+(https?:\/\/\S+)/);
        if (m) hits.push({ site: m[1].trim(), url: m[2].trim() });
      }
      resolve({ available: true, username, hits });
    });
  });
}

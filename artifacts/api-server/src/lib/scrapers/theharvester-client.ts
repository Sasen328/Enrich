// §6 — TheHarvester OSINT (emails + subdomains from search engines/PGP/CT).
// Spawns theHarvester CLI in the Scout container if present; degrades cleanly.
import { spawn } from "node:child_process";

export interface HarvesterResult { available: boolean; domain: string; emails: string[]; hosts: string[]; }

export async function harvestEmails(domain: string, timeoutMs = 90000): Promise<HarvesterResult> {
  const bin = process.env.THEHARVESTER_BIN || "theHarvester";
  return new Promise((resolve) => {
    let out = "";
    let proc;
    try {
      proc = spawn(bin, ["-d", domain, "-b", "all", "-f", "/dev/stdout"], { timeout: timeoutMs });
    } catch {
      return resolve({ available: false, domain, emails: [], hosts: [] });
    }
    proc.on("error", () => resolve({ available: false, domain, emails: [], hosts: [] }));
    proc.stdout?.on("data", (d) => (out += d.toString()));
    proc.on("close", () => {
      const emails = [...new Set(out.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [])];
      const hosts = [...new Set(out.match(/\b[\w-]+\.[\w.-]+\.\w{2,}\b/g) ?? [])].filter(h => h.endsWith(domain) || h.includes(domain.split(".")[0]));
      resolve({ available: true, domain, emails, hosts });
    });
  });
}

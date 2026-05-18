import { URL } from "url";
import dns from "dns/promises";
import net from "net";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
]);

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;

  if (parts[0] === 0) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] >= 224) return true;

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1") return true;
  if (normalized === "::") return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("::ffff:")) {
    const ipv4Part = normalized.slice(7);
    if (net.isIPv4(ipv4Part)) return isPrivateIPv4(ipv4Part);
  }
  return false;
}

function normalizeIPv4(ip: string): string | null {
  const octalMatch = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (octalMatch) {
    const parts = octalMatch.slice(1).map((p) => {
      if (p.startsWith("0") && p.length > 1) return parseInt(p, 8);
      return parseInt(p, 10);
    });
    if (parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null;
    return parts.join(".");
  }

  const longMatch = ip.match(/^(\d+)$/);
  if (longMatch) {
    const num = parseInt(longMatch[1], 10);
    if (num > 0xFFFFFFFF) return null;
    return [
      (num >>> 24) & 0xFF,
      (num >>> 16) & 0xFF,
      (num >>> 8) & 0xFF,
      num & 0xFF,
    ].join(".");
  }

  return ip;
}

function isIPAddress(hostname: string): boolean {
  return net.isIPv4(hostname) || net.isIPv6(hostname) || /^\d+$/.test(hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(hostname);
}

export async function validateUrl(url: string): Promise<{ valid: boolean; error?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { valid: false, error: "Only HTTP and HTTPS protocols are allowed" };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) {
    return { valid: false, error: "Access to internal hosts is not allowed" };
  }

  if (net.isIPv4(hostname) || /^\d+(\.\d+)*$/.test(hostname)) {
    const normalized = normalizeIPv4(hostname);
    if (!normalized) return { valid: false, error: "Invalid IP address" };
    if (isPrivateIPv4(normalized)) {
      return { valid: false, error: "Access to private network addresses is not allowed" };
    }
    return { valid: true };
  }

  if (net.isIPv6(hostname) || hostname.includes(":")) {
    if (isPrivateIPv6(hostname)) {
      return { valid: false, error: "Access to private network addresses is not allowed" };
    }
    return { valid: true };
  }

  try {
    const addresses4 = await dns.resolve4(hostname).catch(() => []);
    const addresses6 = await dns.resolve6(hostname).catch(() => []);
    const allAddresses = [...addresses4, ...addresses6];

    if (allAddresses.length === 0) {
      return { valid: true };
    }

    for (const ip of allAddresses) {
      if (net.isIPv4(ip) && isPrivateIPv4(ip)) {
        return { valid: false, error: "URL resolves to a private network address" };
      }
      if (net.isIPv6(ip) && isPrivateIPv6(ip)) {
        return { valid: false, error: "URL resolves to a private network address" };
      }
    }
  } catch {
    return { valid: true };
  }

  return { valid: true };
}

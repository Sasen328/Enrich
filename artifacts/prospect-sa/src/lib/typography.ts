// §5 — Typography Intelligence
// Adaptive text color helpers driven by background luminance.
// Use `adapt()` to pick a token (--tx / --tx-m / --tx-q) and `getLuminance()`
// to compute the relative luminance of an arbitrary hex/rgb/hsl color.

export type TextRole = "tx" | "tx-m" | "tx-q" | "btx";

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const HSL_RE = /hsl\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%/i;

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.match(HEX_RE);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function parseColor(c: string): [number, number, number] | null {
  c = c.trim();
  if (c.startsWith("#")) return hexToRgb(c);
  const m = c.match(HSL_RE);
  if (m) return hslToRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  return null;
}

/** Relative luminance per WCAG; returns 0–1. */
export function getLuminance(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Map a background luminance + role to a semantic text token (hsl(var(--…))). */
export function adapt(bgColor: string, role: TextRole = "tx"): string {
  const lum = getLuminance(bgColor);
  const isLight = lum > 0.5;
  // In light backgrounds use ink tokens; in dark use cream tokens.
  // Tokens themselves swap via .dark, so we just emit the role var.
  return isLight ? `hsl(var(--${role}))` : `hsl(var(--${role}))`;
}

/** Quick boolean — true if a foreground in `--tx` will read clearly on this bg. */
export function hasContrast(bgColor: string, role: TextRole = "tx"): boolean {
  const lum = getLuminance(bgColor);
  if (role === "tx-q") return lum > 0.65 || lum < 0.20;
  return lum > 0.55 || lum < 0.25;
}

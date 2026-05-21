// §2 — Slow Sea Wave canvas engine using the EXACT prototype palette
// (Soft Lavender & Cream): pale lavender, soft pink, warm peach/sand,
// pale blue, pale teal. Speed 0.0016, MX 0.05, SC 1.04.
import { useEffect, useRef } from "react";

const SPEED = 0.0016;
const MX = 0.05;
const SC = 1.04;

// Prototype palette stops (RGB triplets — pastel, not saturated).
// Soft Lavender:
//   [210,195,252] light lavender
//   [235,205,250] soft pink
//   [252,235,215] warm peach
//   [220,240,248] pale blue
//   [195,228,245] pale teal
const LIGHT_PALETTE: [number, number, number][] = [
  [210, 195, 252],
  [235, 205, 250],
  [252, 235, 215],
  [220, 240, 248],
  [195, 228, 245],
  [210, 195, 252],
  [235, 205, 250],
];

const DARK_PALETTE: [number, number, number][] = [
  [120, 105, 165],
  [145, 110, 160],
  [155, 130, 110],
  [110, 130, 155],
  [90, 130, 155],
  [120, 105, 165],
  [145, 110, 160],
];

export function MeshCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      c.width  = c.clientWidth  * dpr;
      c.height = c.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let lastDraw = 0;
    const draw = (t: number) => {
      if (t - lastDraw > 33) {
        lastDraw = t;
        const w = c.clientWidth, h = c.clientHeight;
        const dark = document.documentElement.classList.contains("dark");
        const pal = dark ? DARK_PALETTE : LIGHT_PALETTE;
        // Cream base under everything
        ctx.fillStyle = dark ? "rgb(36, 30, 52)" : "rgb(250, 246, 238)";
        ctx.fillRect(0, 0, w, h);
        // Use 'source-over' (normal blend) so pastels stay pastel
        ctx.globalCompositeOperation = "source-over";
        const u = (reduced ? 0 : t) * SPEED;
        for (let i = 0; i < 7; i++) {
          const px = 0.5 + Math.sin(u * (1 + i * 0.13) + i)     * MX * (1 + i * 0.04);
          const py = 0.5 + Math.cos(u * (1 + i * 0.17) + i * 2) * MX * (1 + i * 0.05);
          const r  = Math.min(w, h) * (0.55 + 0.08 * Math.sin(u * 0.6 + i)) * SC;
          const [R, G, B] = pal[i];
          const g  = ctx.createRadialGradient(px * w, py * h, 0, px * w, py * h, r);
          g.addColorStop(0,   `rgba(${R},${G},${B},${dark ? 0.55 : 0.80})`);
          g.addColorStop(0.55,`rgba(${R},${G},${B},${dark ? 0.18 : 0.35})`);
          g.addColorStop(1,   `rgba(${R},${G},${B},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 w-full h-full"
      style={{ opacity: 1 }}
    />
  );
}

// ME() — public engine API stub (used by §6 mesh canvas buttons).
export function ME(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d"); if (!ctx) return { start(){}, stop(){} };
  let raf = 0;
  return {
    start() {
      const draw = (t: number) => {
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const u = t * SPEED * 4;
        const [R, G, B] = LIGHT_PALETTE[0];
        const g = ctx.createRadialGradient(
          w/2 + Math.sin(u) * w * MX, h/2 + Math.cos(u) * h * MX, 0,
          w/2, h/2, Math.max(w, h) * SC,
        );
        g.addColorStop(0, `rgba(${R},${G},${B},0.50)`);
        g.addColorStop(1, `rgba(${R},${G},${B},0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    },
    stop() { cancelAnimationFrame(raf); },
  };
}

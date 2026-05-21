// §2 — Slow Sea Wave canvas engine. ME() API.
// One <canvas> behind the app. ~30fps; respects prefers-reduced-motion.
// Speed 0.0016, MX 0.05, BG blend, SC scale factor, 7-harmonic sine field.
import { useEffect, useRef } from "react";

const SPEED = 0.0016;
const MX = 0.05;
const SC = 1.04;

export function MeshCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d", { alpha: true });
    if (!ctx) return;

    let raf = 0;
    const palette = () => {
      const root = getComputedStyle(document.documentElement);
      return [
        root.getPropertyValue("--brand-lavender").trim(),
        root.getPropertyValue("--brand-seafoam").trim(),
        root.getPropertyValue("--brand-sand").trim(),
        root.getPropertyValue("--brand-rose").trim(),
        root.getPropertyValue("--brand-mist").trim(),
        root.getPropertyValue("--brand-sky").trim(),
        root.getPropertyValue("--brand-lavender").trim(),
      ];
    };

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
      if (t - lastDraw > 33) { // ~30fps
        lastDraw = t;
        const w = c.clientWidth, h = c.clientHeight;
        // Paint base cream first so we always have a warm canvas under the mesh
        const root = getComputedStyle(document.documentElement);
        ctx.fillStyle = `hsl(${root.getPropertyValue("--brand-cream").trim()})`;
        if (document.documentElement.classList.contains("dark")) {
          ctx.fillStyle = `hsl(${root.getPropertyValue("--background").trim()})`;
        }
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "lighter";
        const cols = palette();
        const u = t * SPEED;
        for (let i = 0; i < 7; i++) {
          // 7-harmonic sine field
          const px = 0.5 + Math.sin(u * (1 + i * 0.13) + i)     * MX * (1 + i * 0.04);
          const py = 0.5 + Math.cos(u * (1 + i * 0.17) + i * 2) * MX * (1 + i * 0.05);
          const r  = Math.min(w, h) * (0.45 + 0.06 * Math.sin(u * 0.6 + i)) * SC;
          const g  = ctx.createRadialGradient(px * w, py * h, 0, px * w, py * h, r);
          g.addColorStop(0,   `hsla(${cols[i]} / 0.55)`);
          g.addColorStop(0.6, `hsla(${cols[i]} / 0.18)`);
          g.addColorStop(1,   "hsla(0 0% 0% / 0)");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.globalCompositeOperation = "source-over";
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
        const root = getComputedStyle(document.documentElement);
        const lav = root.getPropertyValue("--brand-lavender").trim();
        const g = ctx.createRadialGradient(
          w/2 + Math.sin(u) * w * MX, h/2 + Math.cos(u) * h * MX, 0,
          w/2, h/2, Math.max(w, h) * SC,
        );
        g.addColorStop(0,   `hsla(${lav} / 0.35)`);
        g.addColorStop(1,   "hsla(0 0% 0% / 0)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    },
    stop() { cancelAnimationFrame(raf); },
  };
}

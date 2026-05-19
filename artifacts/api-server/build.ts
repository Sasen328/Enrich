import path from "path";
import { fileURLToPath } from "url";
import { build as esbuild } from "esbuild";
import { rm, readFile, mkdir, copyFile, readdir } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times without risking some
// packages that are not bundle compatible
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function copySeedData() {
  const src = path.resolve(__dirname, "src/seed-data");
  const dest = path.resolve(__dirname, "seed-data");
  await mkdir(dest, { recursive: true });
  const files = await readdir(src);
  const gz = files.filter((f) => f.endsWith(".gz"));
  await Promise.all(gz.map((f) => copyFile(path.join(src, f), path.join(dest, f))));
  console.log(`copied ${gz.length} seed-data files → seed-data/`);
}

async function buildAll() {
  const distDir = path.resolve(__dirname, "dist");
  await rm(distDir, { recursive: true, force: true });

  console.log("building server...");
  const pkgPath = path.resolve(__dirname, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));

  // ── Externals strategy ────────────────────────────────────────────────────
  // Previously: bundled allowlisted packages, externalized everything else.
  // That assumed every non-bundled dep would resolve at runtime via
  // node_modules walking, which breaks in pnpm symlink farms and when running
  // the CJS bundle from /app/artifacts/api-server/dist/. The result was
  // "Cannot find module" crashes the moment the container booted.
  //
  // New strategy: externalize ONLY the deps that are known to be incompatible
  // with bundling (native bindings, dynamic-require packages, browser binaries).
  // Everything else gets bundled. Workspace deps (workspace:*) stay inlined.
  const KNOWN_INCOMPATIBLE = new Set([
    "playwright",
    "playwright-core",
    "puppeteer",
    "puppeteer-core",
    "puppeteer-extra",
    "puppeteer-extra-plugin-stealth",
    "pdfkit",          // native pdf rendering
    "@types/pdfkit",
    "drizzle-kit",     // CLI, not a runtime dep
    "tsx",             // build-time only
    "typescript",      // build-time only
    "esbuild",         // build-time only
    "vite",            // build-time only
  ]);
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter(
    (dep) =>
      KNOWN_INCOMPATIBLE.has(dep) &&
      !(pkg.dependencies?.[dep]?.startsWith("workspace:")),
  );
  console.log(`externals: ${externals.join(", ") || "(none)"}`);

  await esbuild({
    entryPoints: [path.resolve(__dirname, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: path.resolve(distDir, "index.cjs"),
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    // Preserve readable error stacks so runtime crashes are debuggable.
    // Re-enable minify once the deploy is stable.
    minify: false,
    sourcemap: "inline",
    external: externals,
    logLevel: "info",
  });

  await copySeedData();
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});

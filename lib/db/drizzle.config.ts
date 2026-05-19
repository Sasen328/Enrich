import { defineConfig } from "drizzle-kit";
import path from "path";
import { fileURLToPath } from "url";

// __dirname is CJS-only; derive it from import.meta.url for ESM
// (lib/db/package.json declares "type": "module").
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});

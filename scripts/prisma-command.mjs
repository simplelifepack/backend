import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const prismaCli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));

const command = process.argv[2];
const prismaArgs =
  command === "migrate-deploy"
    ? ["migrate", "deploy"]
    : command === "generate"
      ? ["generate"]
      : null;

if (!prismaArgs) {
  console.error("Usage: node scripts/prisma-command.mjs <generate|migrate-deploy>");
  process.exit(1);
}

if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
  process.env.DIRECT_URL = deriveDirectUrl(process.env.DATABASE_URL);
}

const result = spawnSync(process.execPath, [prismaCli, ...prismaArgs], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);

function deriveDirectUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "6543") {
      url.port = "5432";
      url.searchParams.delete("pgbouncer");
      return url.toString();
    }

    return rawUrl;
  } catch {
    return rawUrl;
  }
}

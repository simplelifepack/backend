import { spawnSync } from "node:child_process";
import { vercelBuildCommands } from "../privacy/vercelMigration";

try {
  for (const args of vercelBuildCommands(process.env)) {
    const child = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
    if (child.error || child.signal || child.status !== 0) {
      process.exitCode = 1;
      break;
    }
  }
} catch {
  console.error(JSON.stringify({ completed: false, code: "INVALID_VERCEL_MIGRATION_BUILD_CONFIGURATION" }));
  process.exitCode = 1;
}

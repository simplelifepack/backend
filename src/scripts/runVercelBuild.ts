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
  if (!process.exitCode && process.env.DIGILOCKER_MOBILE_VERIFICATION === "1") {
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/scripts/verifyDigiLockerMobileHosted.ts"], { stdio: "inherit", env: process.env });
    // Verification builds must never replace the serving production deployment.
    process.exitCode = result.status === 0 ? 42 : 1;
  }
} catch {
  console.error(JSON.stringify({ completed: false, code: "INVALID_VERCEL_MIGRATION_BUILD_CONFIGURATION" }));
  process.exitCode = 1;
}

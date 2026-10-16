import path from "node:path";
import { spawn } from "node:child_process";
import { configureNormalLocalBackend } from "./localBackendEnvironment";

// Run the current branch with the existing normal local secrets and storage.
const position = process.argv.indexOf("--env-file");
configureNormalLocalBackend(position >= 0 ? process.argv[position + 1] : undefined);
const root = path.resolve(__dirname, "../..");
const child = spawn(process.execPath, ["--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), path.join(root, "src/index.ts")], { cwd: root, env: process.env, stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", code => { process.exitCode = code ?? 1; });

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nodeFileTrace } from "@vercel/nft";
import ts from "typescript";

test("Packages dependencies load in a CommonJS-only serverless runtime", () => {
  execFileSync(process.execPath, [
    "--no-experimental-require-module",
    "-e",
    'require("htmlparser2"); require("sanitize-html"); require("openai/helpers/zod");',
  ], { cwd: path.resolve(__dirname, "../.."), stdio: "pipe" });
});

test("the serverless Packages route includes the refresh schema helper", async () => {
  const base = path.resolve(__dirname, "../..");
  const { fileList } = await nodeFileTrace([path.join(base, "api/index.ts")], {
    base,
    readFile: async (file) => {
      const source = await readFile(file, "utf8");
      if (!file.endsWith(".ts") || file.endsWith(".d.ts")) return source;
      return ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      }).outputText;
    },
  });
  assert(fileList.has("src/routes/packs.routes.ts"));
  assert(fileList.has(path.relative(base, require.resolve("openai/helpers/zod"))), "Vercel must ship the helper needed to load Packages.");
});

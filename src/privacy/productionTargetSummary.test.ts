import assert from "node:assert/strict";
import { test } from "node:test";
import { productionTargetSummary } from "./productionTargetSummary";
const ref = "abcdefghijklmnopqrst";
const env = { DATABASE_URL: `postgresql://postgres.${ref}:SYNTHETIC-SECRET@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require`, DIRECT_URL: `postgresql://postgres:SYNTHETIC-SECRET@db.${ref}.supabase.co:5432/postgres`, STORAGE_ENDPOINT: `https://${ref}.storage.supabase.co/storage/v1/s3?token=SYNTHETIC-SECRET` };
test("target summary reports only public Supabase references/provider and no secrets", () => {
  const report = productionTargetSummary(env);
  assert.equal(report.databaseProjectRef, ref); assert.equal(report.directProjectRef, ref); assert.equal(report.storageProjectRef, ref); assert.equal(report.storageProvider, "supabase-storage"); assert.equal(report.remoteConnectivityVerified, false);
  const text = JSON.stringify(report); assert(!text.includes("SYNTHETIC-SECRET")); assert(!text.includes("postgresql:")); assert(!text.includes("https:")); assert(!text.includes("storage/v1"));
});
test("different pooler/direct projects fail closed", () => {
  assert.throws(() => productionTargetSummary({ ...env, DIRECT_URL: "postgresql://postgres:SYNTHETIC@db.zyxwvutsrqponmlkjihg.supabase.co/postgres" }), /TARGET_MISMATCH/);
});
test("other S3 providers do not expose account IDs or bucket names", () => {
  for (const [endpoint, provider] of [["https://private-account.r2.cloudflarestorage.com/private-bucket", "cloudflare-r2"], ["https://s3.ap-south-1.amazonaws.com/private-bucket", "aws-s3"], ["https://private-bucket.s3.amazonaws.com", "aws-s3"], ["https://private-account.unknown-storage.example", "s3-compatible"]]) {
    const report = productionTargetSummary({ ...env, STORAGE_ENDPOINT: endpoint }); assert.equal(report.storageProvider, provider); assert.equal(report.storageProjectRef, null); assert(!JSON.stringify(report).includes("private-"));
  }
});

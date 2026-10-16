/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { encryptPrivateValue, decryptPrivateValue, assertPrivateDataKeysConfigured } from "../privacy/fieldEncryption";
import { withPrivateMigration } from "../privacy/access";
import { encryptedModels, modelDefinitions, decodePrivateRow, protectedFields, cipherColumn, newPrivateId } from "../privacy/modelCodec";
import { migrateHealthRow } from "../privacy/migrateHealth";
import { decryptCleanupLocator, encryptedCleanupLocator } from "../privacy/storageLocator";

// Deliberately raw client: offline maintenance is the only path allowed to read
// legacy plaintext. Runtime clients fail closed on any missing cipher column.
const raw = new PrismaClient({ log: [] });
async function run() {
  assertPrivateDataKeysConfigured();
  const apply = process.argv.includes("--apply"), verify = process.argv.includes("--verify");
  if (apply && verify) throw new Error("Choose apply or verify.");
  const totals: Record<string, { scanned: number; pending: number; updated: number }> = {};
  const selector = process.argv.find(value => value.startsWith("--models="))?.slice(9);
  if (selector && selector !== "health") throw new Error("Unsupported migration model group.");
  const targets = [...encryptedModels].filter(model => !selector || model.startsWith("Health") || model === "TrackedHealthMetric");
  for (const model of targets) {
    const delegate = model[0].toLowerCase() + model.slice(1);
    const table = modelDefinitions.get(model)!.dbName || model;
    if (!/^[A-Za-z_]+$/.test(table)) throw new Error("Invalid maintenance table.");
    const counts = totals[model] = { scanned: 0, pending: 0, updated: 0 };
    let cursor: string | undefined;
    for (;;) {
      // Model names come from the compiled policy, never input or database text.
      const rows: Record<string, unknown>[] = await (raw as any)[delegate].findMany({ take: 100, orderBy: { id: "asc" }, ...(cursor ? { where: { id: { gt: cursor } } } : {}) });
      if (!rows.length) break;
      // Resolve provenance once per keyset batch. Rechecking parents inside each
      // write transaction below still protects against concurrent ownership drift.
      const packOwners = model === "Requirement" ? new Map((await raw.readinessPack.findMany({ where: { id: { in: [...new Set(rows.map(row => String(row.packId)))] } }, select: { id: true, createdBy: true } })).map(parent => [parent.id, parent.createdBy])) : null;
      const documentOwners = model === "DocumentFile" ? new Map((await raw.document.findMany({ where: { id: { in: [...new Set(rows.map(row => String(row.documentId)))] } }, select: { id: true, ownerProfileId: true } })).map(parent => [parent.id, parent.ownerProfileId])) : null;
      for (const row of rows) {
        counts.scanned++;
        let inheritedOwnerChanged = false;
        if (model === "Requirement") {
          if (!packOwners?.has(String(row.packId))) throw new Error("Missing package parent.");
          const owner = packOwners.get(String(row.packId))!;
          inheritedOwnerChanged = row.privacyOwnerId !== owner;
          row.privacyOwnerId = owner;
        }
        if (model === "DocumentFile") {
          if (!documentOwners?.has(String(row.documentId))) throw new Error("Missing document parent.");
          const owner = documentOwners.get(String(row.documentId));
          inheritedOwnerChanged = row.privacyOwnerId !== owner;
          row.privacyOwnerId = owner;
        }
        if (model === "ReadinessPack" && row.createdBy === "seed" && row.legacyPrivateMetadata) decryptPrivateValue(row.legacyPrivateMetadata as string, { model: "ReadinessPack", recordId: String(row.id), ownerId: "legacy-catalogue", field: "legacyPrivateMetadata" });
        const patch = migrateHealthRow(model, row);
        const rekeyRequirementId = model === "Requirement" && row.privacyOwnerId !== "seed" && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(row.id));
        if (rekeyRequirementId) patch.id = "pending-opaque-id";
        if (model === "ReadinessPack" && row.cataloguePrivacyVersion !== 2) patch.cataloguePrivacyVersion = 2;
        if (inheritedOwnerChanged) patch.privacyOwnerId = row.privacyOwnerId;
        if (!Object.keys(patch).length) continue;
        counts.pending++;
        if (apply) await raw.$transaction(async tx => {
          await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, row.id);
          const current = await (tx as any)[delegate].findUnique({ where: { id: row.id } });
          if (!current) return;
          let inheritedOwner: string | null | undefined;
          if (model === "Requirement") {
            const parent = await tx.readinessPack.findUnique({ where: { id: current.packId }, select: { createdBy: true } });
            if (!parent) throw new Error("Missing package parent.");
            inheritedOwner = parent.createdBy;
            current.privacyOwnerId = inheritedOwner;
          }
          if (model === "DocumentFile") {
            const parent = await tx.document.findUnique({ where: { id: current.documentId }, select: { ownerProfileId: true } });
            if (!parent) throw new Error("Missing document parent.");
            inheritedOwner = parent.ownerProfileId;
            current.privacyOwnerId = inheritedOwner;
          }
          let data = migrateHealthRow(model, current);
          if (model === "Requirement" && current.privacyOwnerId !== "seed" && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(current.id)) {
            const plain = { ...current };
            for (const field of protectedFields(model)) if (current[cipherColumn(field.name)]) plain[field.name] = decodePrivateRow(model, current, new Set([field.name]))[field.name];
            for (const field of protectedFields(model)) delete plain[cipherColumn(field.name)];
            plain.id = newPrivateId();
            data = { ...migrateHealthRow(model, plain), id: plain.id };
          }
          if (model === "ReadinessPack" && current.createdBy === "seed" && current.cataloguePrivacyVersion !== 2) {
            const fields = ["aliases", "keywords", "searchMetadata", "sourceName", "sourceTitle", "sourceUrl", "lastCheckedAt", "verificationSources", "lastVerifiedAt", "verificationStatus"];
            const snapshot = Object.fromEntries(fields.map(field => [field, current[field]]));
            data.legacyPrivateMetadata = encryptPrivateValue(snapshot, { model, recordId: current.id, ownerId: "legacy-catalogue", field: "legacyPrivateMetadata" });
            Object.assign(data, { aliases: [], keywords: [], searchMetadata: Prisma.DbNull, sourceName: null, sourceTitle: null, sourceUrl: null, lastCheckedAt: null, verificationSources: Prisma.DbNull, lastVerifiedAt: null, verificationStatus: "needs_review", cataloguePrivacyVersion: 2 });
          }
          if (model === "ReadinessPack") data.cataloguePrivacyVersion = 2;
          if (["DocumentFile", "Requirement"].includes(model)) data.privacyOwnerId = inheritedOwner;
          if (!Object.keys(data).length) return;
          const updated = await (tx as any)[delegate].update({ where: { id: row.id }, data });
          decodePrivateRow(model, updated);
          counts.updated++;
        });
      }
      cursor = String(rows[rows.length - 1].id);
    }
  }
  if (!selector) {
    const counts = totals.StorageCleanup = { scanned: 0, pending: 0, updated: 0 };
    let cursor: string | undefined;
    for (;;) {
      const rows = await raw.storageCleanup.findMany({ take: 100, orderBy: { storageKey: "asc" }, ...(cursor ? { where: { storageKey: { gt: cursor } } } : {}) });
      if (!rows.length) break;
      for (const row of rows) {
        counts.scanned++;
        if (row.encryptedKey) { decryptCleanupLocator(row); continue; }
        counts.pending++;
        if (apply) await raw.$transaction(async tx => {
          const encrypted = encryptedCleanupLocator(row.ownerUserId, row.storageKey);
          const current = await tx.storageCleanup.findUnique({ where: { storageKey: row.storageKey } });
          if (!current) return;
          await tx.storageCleanup.upsert({ where: { storageKey: encrypted.storageKey }, create: { ...current, ...encrypted }, update: { encryptedKey: encrypted.encryptedKey } });
          await tx.storageCleanup.delete({ where: { storageKey: row.storageKey } });
          counts.updated++;
        });
      }
      cursor = rows[rows.length - 1].storageKey;
    }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : verify ? "verify" : "dry-run", models: totals }));
  if (verify && Object.values(totals).some(counts => counts.pending)) process.exitCode = 1;
}
withPrivateMigration("offline private record encryption backfill", run).catch(() => {
  console.error("Private record encryption migration failed. Check key/schema configuration and retry; completed rows are preserved.");
  process.exitCode = 1;
}).finally(() => raw.$disconnect());

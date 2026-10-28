import { withCredentialLookup, withPrivateUser } from "../privacy/access";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { invalidatePackageCatalogueCaches } from "./packs.service";
import { activeRequirementsWhere } from "./readiness/activeRequirements";
import { normalizeRequirementDocumentTypes, slugify } from "./readiness/normalization";
import bcrypt from "bcrypt";
import { previewCsv, createAdminPackage } from "./adminPackageCrud";


export async function previewCsvWithDatabase(csv: string) {
  const preview = previewCsv(csv);
  const slugs = preview.rows.map((row) => row.slug).filter(Boolean);
  const titles = preview.rows.map((row) => row.input?.title).filter((value): value is string => Boolean(value));
  if (!slugs.length && !titles.length) return preview;
  const duplicates = await prisma.readinessPack.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...(slugs.length ? [{ slug: { in: slugs } }] : []),
        ...(titles.length ? titles.map((title) => ({ title: { equals: title, mode: "insensitive" as const } })) : []),
      ],
    },
    select: { slug: true, title: true },
  });
  if (!duplicates.length) return preview;
  const duplicateSlugs = new Set(duplicates.map((item) => item.slug));
  const duplicateTitles = new Set(duplicates.map((item) => item.title.toLowerCase()));
  const rows = preview.rows.map((row) => {
    const errors = [...row.errors];
    if (duplicateSlugs.has(row.slug) || (row.input && duplicateTitles.has(row.input.title.toLowerCase()))) errors.push("Duplicate existing package.");
    return { ...row, errors: [...new Set(errors)] };
  });
  return {
    ...preview,
    rows,
    summary: { valid: rows.filter((row) => !row.errors.length).length, invalid: rows.filter((row) => row.errors.length).length },
  };
}


export async function importCsv(csv: string) {
  const preview = previewCsv(csv);
  const results = await Promise.all(preview.rows.map(async (row) => {
    if (row.errors.length || !row.input) return { rowNumber: row.rowNumber, status: "failed" as const, errors: row.errors };
    const duplicate = await prisma.readinessPack.findFirst({
      where: { deletedAt: null, OR: [{ slug: row.slug }, { title: { equals: row.input.title, mode: "insensitive" } }] },
      select: { id: true },
    });
    if (duplicate) return { rowNumber: row.rowNumber, status: "failed" as const, errors: ["Duplicate existing package."] };
    try {
      await createAdminPackage(row.input);
      return { rowNumber: row.rowNumber, status: "created" as const, errors: [] };
    } catch (error) {
      return { rowNumber: row.rowNumber, status: "failed" as const, errors: [error instanceof Error ? error.message : "Import failed."] };
    }
  }));
  return {
    results,
    successCount: results.filter((row) => row.status === "created").length,
    failedCount: results.filter((row) => row.status === "failed").length,
  };
}


export function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]!;
    const next = csv[index + 1];
    if (quoted && char === "\"" && next === "\"") { cell += "\""; index += 1; continue; }
    if (char === "\"") { quoted = !quoted; continue; }
    if (!quoted && char === ",") { row.push(cell); cell = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = ""; continue;
    }
    cell += char;
  }
  row.push(cell);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}


export function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

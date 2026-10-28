import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { normalizeRequirementDocumentTypes, slugify } from "../services/readiness/normalization";
import { type EventPackage, ICON_NAMES, DEFAULT_LAST_CHECKED, REQUIRED_DEFAULT_PACKAGE_NAMES } from "./defaultPackageEvents";
import { toDefaultPackageRecord, toDefaultRequirementRecords, assertUnique, summary } from "./defaultPackageRecords";


export async function main() {
  const options = readOptions();
  const events = requiredEvents(readEvents(options.sourcePath));
  const packages = events.map(toDefaultPackageRecord);
  const requirements = events.flatMap(toDefaultRequirementRecords);

  assertUnique(packages.map((pack) => pack.slug), "package slug");
  assertUnique(requirements.map((requirement) => requirement.id), "requirement id");

  if (options.dryRun) {
    console.info("[Default Packages Import] dry run", summary(packages, requirements));
    return;
  }

  await prisma.$transaction(async (tx) => {
    const eventSlugs = packages.map((pack) => pack.slug);
    const requirementIds = requirements.map((requirement) => requirement.id);

    const conflictingPacks = await tx.readinessPack.findMany({
      where: { slug: { in: eventSlugs }, createdBy: { not: "seed" } },
      select: { slug: true, createdBy: true },
    });
    if (conflictingPacks.length) {
      throw new Error(`Cannot import default packages because non-system packs already use these slugs: ${conflictingPacks.map((pack) => `${pack.slug} (${pack.createdBy})`).join(", ")}`);
    }

    const conflictingRequirements = await tx.requirement.findMany({
      where: { id: { in: requirementIds }, pack: { createdBy: { not: "seed" } } },
      select: { id: true, pack: { select: { slug: true, createdBy: true } } },
    });
    if (conflictingRequirements.length) {
      throw new Error(`Cannot import default requirements because non-system requirements already use these IDs: ${conflictingRequirements.map((requirement) => `${requirement.id} (${requirement.pack.slug})`).join(", ")}`);
    }

    await tx.readinessPack.deleteMany({
      where: { createdBy: "seed", slug: { notIn: eventSlugs } },
    });

    const packIdBySlug = new Map<string, string>();
    for (const pack of packages) {
      const saved = await tx.readinessPack.upsert({
        where: { slug: pack.slug },
        create: {
          id: pack.id,
          slug: pack.slug,
          title: pack.title,
          subtitle: pack.subtitle,
          category: pack.category,
          aliases: [],
          description: pack.description,
          keywords: [],
          searchMetadata: pack.searchMetadata,
          sourceType: "curated",
          sourceName: pack.sourceName,
          sourceTitle: pack.sourceTitle,
          sourceUrl: null,
          lastCheckedAt: pack.lastCheckedAt,
          verificationSources: pack.verificationSources,
          lastVerifiedAt: pack.lastCheckedAt,
          verificationStatus: "verified",
          createdBy: "seed",
          version: 1,
        },
        update: {
          title: pack.title,
          subtitle: pack.subtitle,
          category: pack.category,
          aliases: [],
          description: pack.description,
          keywords: [],
          searchMetadata: pack.searchMetadata,
          sourceType: "curated",
          sourceName: pack.sourceName,
          sourceTitle: pack.sourceTitle,
          sourceUrl: null,
          lastCheckedAt: pack.lastCheckedAt,
          verificationSources: pack.verificationSources,
          lastVerifiedAt: pack.lastCheckedAt,
          verificationStatus: "verified",
          createdBy: "seed",
          version: 1,
        },
        select: { id: true, slug: true },
      });
      packIdBySlug.set(saved.slug, saved.id);
    }

    await tx.requirement.deleteMany({
      where: { pack: { createdBy: "seed" }, id: { notIn: requirementIds } },
    });

    for (const requirement of requirements) {
      const packId = packIdBySlug.get(requirement.slug);
      if (!packId) throw new Error(`Missing imported package for requirement ${requirement.id}`);
      await tx.requirement.upsert({
        where: { id: requirement.id },
        create: {
          id: requirement.id,
          packId,
          title: requirement.title,
          documentType: requirement.documentType,
          owner: requirement.owner,
          metadata: requirement.metadata,
          description: requirement.description,
          required: requirement.required,
          group: requirement.group,
          acceptedDocumentTypes: requirement.acceptedDocumentTypes,
          alternativeLabels: requirement.alternativeLabels,
          sortOrder: requirement.sortOrder,
        },
        update: {
          packId,
          title: requirement.title,
          documentType: requirement.documentType,
          owner: requirement.owner,
          metadata: requirement.metadata,
          description: requirement.description,
          required: requirement.required,
          group: requirement.group,
          acceptedDocumentTypes: requirement.acceptedDocumentTypes,
          alternativeLabels: requirement.alternativeLabels,
          sortOrder: requirement.sortOrder,
        },
      });
    }
  });

  console.info("[Default Packages Import] imported", summary(packages, requirements));
}


export function readOptions() {
  const args = process.argv.slice(2);
  const sourceArg = args.find((arg) => arg.startsWith("--source="));
  return {
    dryRun: args.includes("--dry-run"),
    sourcePath: path.resolve(sourceArg?.split("=")[1] ?? process.env.EVENTS_APP_TSX_PATH ?? "../frontend-web/new.tsx"),
  };
}


export function readEvents(sourcePath: string): EventPackage[] {
  const appSource = fs.readFileSync(sourcePath, "utf8");
  const start = appSource.indexOf("const PACK_CAT_META");
  const eventsStart = appSource.indexOf("const EVENTS = [", start);
  const end = appSource.indexOf("];", eventsStart) + 2;
  if (start < 0 || eventsStart < 0 || end < 2) {
    throw new Error(`Could not find PACK_CAT_META and EVENTS in ${sourcePath}`);
  }

  const prefix = [
    "const A = { blue: '#5B8DEF', purple: '#9B7BE8', teal: '#3FB9C7', pink: '#E86A9B', green: '#4FCB95', gold: '#D9B86A' };",
    ...ICON_NAMES.map((icon) => `const ${icon} = '${icon}';`),
  ].join("\n");
  const code = `${prefix}\n${appSource.slice(start, end)}\nexports.EVENTS = EVENTS;`;
  const output = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const sandbox = { exports: {} as { EVENTS?: EventPackage[] } };
  vm.createContext(sandbox);
  vm.runInContext(output, sandbox, { filename: sourcePath });
  const events = sandbox.exports.EVENTS;
  if (!Array.isArray(events) || !events.length) {
    throw new Error(`EVENTS in ${sourcePath} did not evaluate to a package array`);
  }
  return events.map((event) => ({
    ...event,
    conditional: event.conditional ?? [],
    lastChecked: event.source === "" ? "" : event.lastChecked || DEFAULT_LAST_CHECKED,
  }));
}


export function requiredEvents(events: EventPackage[]) {
  assertUnique([...REQUIRED_DEFAULT_PACKAGE_NAMES], "required default package name");
  const byName = new Map(events.map((event) => [event.name, event]));
  const missing = REQUIRED_DEFAULT_PACKAGE_NAMES.filter((name) => !byName.has(name));
  if (missing.length) {
    throw new Error(`Required default packages are missing from EVENTS: ${missing.join(", ")}`);
  }
  return REQUIRED_DEFAULT_PACKAGE_NAMES.map((name) => byName.get(name)!);
}

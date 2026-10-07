import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import { Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { normalizeRequirementDocumentTypes, slugify } from "../services/readiness/normalization";

type EventPackage = {
  id: string;
  name: string;
  blurb: string;
  cat: string;
  reqs: string[];
  conditional?: string[];
  accent: string;
  icon: string;
  source: string;
  lastChecked: string;
};

type DefaultPackageRecord = {
  slug: string;
  id: string;
  title: string;
  subtitle: string;
  category: string;
  description: string;
  searchMetadata: Prisma.InputJsonObject;
  sourceName: string | null;
  sourceTitle: string | null;
  lastCheckedAt: Date | null;
  verificationSources: Prisma.InputJsonArray;
};

type DefaultRequirementRecord = {
  acceptedDocumentTypes: string[];
  alternativeLabels: string[];
  description: string;
  documentType: string;
  group: string;
  id: string;
  metadata: Prisma.InputJsonObject;
  owner: string;
  required: boolean;
  slug: string;
  sortOrder: number;
  title: string;
};

const DEFAULT_LAST_CHECKED = "Jul 25, 2026";
const REFERENCE_SOURCE = "App.tsx EVENTS";
const REQUIRED_DEFAULT_PACKAGE_NAMES = [
  "Schengen visa",
  "UK visa",
  "Canada visa",
  "Australia visitor visa",
  "Japan tourist visa",
  "Singapore visa",
  "UAE visit visa",
  "Travel insurance purchase",
  "International driving permit",
  "Lost passport reissue",
  "Lost driving licence duplicate",
  "Mobile SIM KYC",
  "New passport",
  "Passport renewal",
  "Passport for a minor",
  "Driving license",
  "Driving license renewal",
  "Vehicle registration",
  "Vehicle ownership transfer",
  "Police clearance certificate",
  "Legal name change",
  "Car loan",
  "Personal loan",
  "Education loan",
  "Credit card application",
  "Bank account opening",
  "Loan closure and lien release",
  "Background verification",
  "New job onboarding",
  "Freelance client KYC",
  "Resignation and relieving",
  "School admission",
  "College admission",
  "Postgraduate admission",
  "Study abroad application",
  "Competitive exam application",
  "Scholarship application",
  "School transfer",
  "Degree attestation",
  "Duplicate marksheet reissue",
  "Hospital admission",
  "Health insurance reimbursement",
  "Cashless pre-authorization",
  "New health insurance",
  "Maternity hospital pack",
  "Vaccination record pack",
  "Employer medical reimbursement",
  "Home loan",
  "Property sale",
  "Property purchase",
  "Renting a home",
  "Renting out property",
  "New electricity connection",
  "Home insurance purchase",
  "Marriage registration",
  "Death certificate application",
  "Adoption process",
  "Newborn documentation",
  "Add family member to insurance",
  "Will preparation",
  "Nominee updates",
  "Life insurance claim",
  "Settlements after a death",
  "Pension application",
  "Family pension claim",
] as const;
const ICON_NAMES = [
  "Baby",
  "BookUser",
  "Briefcase",
  "Car",
  "FileText",
  "Gem",
  "GraduationCap",
  "HeartPulse",
  "HomeIcon",
  "IdCard",
  "Landmark",
  "Plane",
  "Shield",
  "ShieldCheck",
  "Users",
  "Wallet",
];

async function main() {
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

function readOptions() {
  const args = process.argv.slice(2);
  const sourceArg = args.find((arg) => arg.startsWith("--source="));
  return {
    dryRun: args.includes("--dry-run"),
    sourcePath: path.resolve(sourceArg?.split("=")[1] ?? process.env.EVENTS_APP_TSX_PATH ?? "../frontend-web/new.tsx"),
  };
}

function readEvents(sourcePath: string): EventPackage[] {
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

function requiredEvents(events: EventPackage[]) {
  assertUnique([...REQUIRED_DEFAULT_PACKAGE_NAMES], "required default package name");
  const byName = new Map(events.map((event) => [event.name, event]));
  const missing = REQUIRED_DEFAULT_PACKAGE_NAMES.filter((name) => !byName.has(name));
  if (missing.length) {
    throw new Error(`Required default packages are missing from EVENTS: ${missing.join(", ")}`);
  }
  return REQUIRED_DEFAULT_PACKAGE_NAMES.map((name) => byName.get(name)!);
}

function toDefaultPackageRecord(event: EventPackage, eventOrder: number): DefaultPackageRecord {
  const hasSource = Boolean(event.source);
  const lastCheckedAt = hasSource ? parseLastChecked(event.lastChecked) : null;
  const searchPhrases = [
    event.name,
    event.blurb,
    event.cat,
    event.source,
    ...event.reqs,
    ...(event.conditional ?? []),
  ].filter(Boolean);
  return {
    slug: event.id,
    id: `seed_pack_${event.id}`,
    title: event.name,
    subtitle: event.blurb,
    category: event.cat,
    description: event.blurb,
    searchMetadata: {
      referenceId: event.id,
      eventId: event.id,
      referenceSource: REFERENCE_SOURCE,
      name: event.name,
      blurb: event.blurb,
      category: event.cat,
      accent: event.accent,
      uiAccent: event.accent,
      icon: event.icon,
      uiIcon: event.icon,
      source: event.source,
      lastChecked: event.lastChecked,
      requiredDocuments: event.reqs,
      conditionalRequirements: event.conditional ?? [],
      searchPhrases,
      categoryOrder: categoryOrder(event.cat),
      eventOrder,
    },
    sourceName: hasSource ? event.source : null,
    sourceTitle: hasSource ? event.source : null,
    lastCheckedAt,
    verificationSources: hasSource && lastCheckedAt ? [{
      title: event.source,
      type: "published_requirement",
      retrievedAt: lastCheckedAt.toISOString(),
    }] : [],
  };
}

function toDefaultRequirementRecords(event: EventPackage): DefaultRequirementRecord[] {
  const requiredTitles = event.reqs.map((title) => ({ title, required: true }));
  const conditionalTitles = (event.conditional ?? [])
    .filter((title) => !event.reqs.includes(title))
    .map((title) => ({ title, required: false }));
  return [...requiredTitles, ...conditionalTitles].map((requirement, sortOrder) => {
    const acceptedDocumentTypes = normalizeRequirementDocumentTypes(slugify(requirement.title), requirement.title);
    return {
      slug: event.id,
      id: requirementId(event.id, requirement.title, !requirement.required),
      title: requirement.title,
      documentType: acceptedDocumentTypes[0] ?? slugify(requirement.title),
      owner: "self",
      metadata: {
        referenceId: event.id,
        referenceSource: REFERENCE_SOURCE,
        eventId: event.id,
        label: requirement.title,
        conditional: !requirement.required,
        requiredInEvents: requirement.required,
      },
      description: "",
      required: requirement.required,
      group: requirement.required ? "Required" : "Conditional",
      acceptedDocumentTypes,
      alternativeLabels: [requirement.title],
      sortOrder,
    };
  });
}

function categoryOrder(category: string) {
  const order = [
    "Travel & Immigration",
    "Identity & Civic",
    "Money & Tax",
    "Jobs & Employment",
    "Education",
    "Health",
    "Home & Property",
    "Family & Life",
  ].indexOf(category);
  if (order < 0) throw new Error(`Unknown EVENTS category: ${category}`);
  return order;
}

function requirementId(slug: string, title: string, conditional: boolean) {
  return `seed_req_${slug}_${slugify(title)}${conditional ? "_conditional" : ""}`;
}

function parseLastChecked(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid EVENTS lastChecked value: ${value}`);
  return parsed;
}

function assertUnique(values: string[], label: string) {
  const seen = new Set<string>();
  const duplicates = values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
  if (duplicates.length) throw new Error(`Duplicate ${label}s: ${[...new Set(duplicates)].join(", ")}`);
}

function summary(packages: DefaultPackageRecord[], requirements: DefaultRequirementRecord[]) {
  return {
    packageCount: packages.length,
    requirementCount: requirements.length,
    categories: [...new Set(packages.map((pack) => pack.category))],
  };
}

main()
  .catch((error) => {
    console.error("[Default Packages Import] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

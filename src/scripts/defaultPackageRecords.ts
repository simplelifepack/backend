import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { normalizeRequirementDocumentTypes, slugify } from "../services/readiness/normalization";
import { type EventPackage, type DefaultPackageRecord, REFERENCE_SOURCE, type DefaultRequirementRecord } from "./defaultPackageEvents";
import { main } from "./defaultPackageImport";


export function toDefaultPackageRecord(event: EventPackage, eventOrder: number): DefaultPackageRecord {
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


export function toDefaultRequirementRecords(event: EventPackage): DefaultRequirementRecord[] {
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


export function categoryOrder(category: string) {
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


export function requirementId(slug: string, title: string, conditional: boolean) {
  return `seed_req_${slug}_${slugify(title)}${conditional ? "_conditional" : ""}`;
}


export function parseLastChecked(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid EVENTS lastChecked value: ${value}`);
  return parsed;
}


export function assertUnique(values: string[], label: string) {
  const seen = new Set<string>();
  const duplicates = values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
  if (duplicates.length) throw new Error(`Duplicate ${label}s: ${[...new Set(duplicates)].join(", ")}`);
}


export function summary(packages: DefaultPackageRecord[], requirements: DefaultRequirementRecord[]) {
  return {
    packageCount: packages.length,
    requirementCount: requirements.length,
    categories: [...new Set(packages.map((pack) => pack.category))],
  };
}

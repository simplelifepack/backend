import { readProviderStream } from "../providerStream";
import type { AIReadinessPackage } from "../intentTypes";
import type { AIProvider, ProviderRequestOptions } from "./types";
import { normalizeRequirementDocumentTypes } from "../../services/readiness/normalization";
import { rankSources } from "../sourceAuthority";
import { MissingAuthoritativeSourceError } from "./openaiProvider";


export function validateIntentAnalysis(value: unknown, options: Pick<ProviderRequestOptions, "allowUnverifiedGuidance"> = {}): AIReadinessPackage {
  if (!value || typeof value !== "object") throw new Error("Invalid readiness package output.");
  const result = value as Record<string, unknown>;
  if (typeof result.packageName !== "string" || !result.packageName.trim() || typeof result.category !== "string" || !result.category.trim() || typeof result.description !== "string" || !Array.isArray(result.requiredDocuments)) throw new Error("Invalid readiness package output.");
  const unverifiedRequested = options.allowUnverifiedGuidance && result.verificationStatus === "unverified_guidance";
  const documents = result.requiredDocuments.filter(unverifiedRequested ? isGuidanceDocument : isRequiredDocument);
  if (!documents.length) throw new Error("Readiness package contains no required documents.");
  const sources = verificationSources(result.verificationSources);
  const primarySource = authoritativePrimarySource(result, sources);
  if (!primarySource && !unverifiedRequested) throw new MissingAuthoritativeSourceError();
  const checkedAt = checkedDate(result.lastChecked, result.lastVerifiedAt, primarySource?.retrievedAt);
  const hasVerifiedOfficialSource = Boolean(primarySource);
  const disclaimer = typeof result.disclaimer === "string" && result.disclaimer.trim()
    ? result.disclaimer.trim().slice(0, 500)
    : hasVerifiedOfficialSource ? undefined : "Official source not found. These documents may still be helpful, but please verify them with the relevant authority.";
  return {
    packageName: result.packageName.trim().slice(0, 120),
    category: result.category.trim().slice(0, 60),
    description: result.description.trim().slice(0, 200),
    searchMetadata: validatedSearchMetadata(result.searchMetadata),
    sourceTitle: primarySource?.title ?? "",
    sourceUrl: primarySource?.url ?? "",
    sourceOrganization: primarySource?.organization ?? "",
    lastChecked: checkedAt,
    verificationSources: sources,
    lastVerifiedAt: primarySource ? checkedAt : null,
    verificationStatus: primarySource ? "verified" : "unverified_guidance",
    hasVerifiedOfficialSource,
    confidence: primarySource ? "high" : "low",
    ...(disclaimer ? { disclaimer } : {}),
    requiredDocuments: documents.map((item) => ({
      id: normalizeId(item.id), category: item.category.trim().slice(0, 60),
      documentType: normalizeRequirementDocumentTypes(item.documentType, item.title)[0]!, owner: item.owner,
      name: item.name.trim().slice(0, 100), title: item.title.trim().slice(0, 100), required: item.required,
      whyNeeded: item.whyNeeded.trim().slice(0, 300), sourceName: item.sourceName.trim().slice(0, 140),
      sourceUrl: item.sourceUrl.trim(), sourceAuthorityTier: item.sourceAuthorityTier,
      lastVerifiedAt: !Number.isNaN(Date.parse(item.lastVerifiedAt)) ? new Date(item.lastVerifiedAt).toISOString() : checkedAt,
    })).filter((item) => item.id && item.category && item.documentType && item.name && item.title).slice(0, 30),
  };
}


export function validatedSearchMetadata(value: unknown): AIReadinessPackage["searchMetadata"] {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof input[key] === "string" && input[key] ? String(input[key]).trim().slice(0, 100) : undefined;
  return { intent: text("intent"), subject: text("subject"), purpose: text("purpose"), jurisdiction: text("jurisdiction"), destination: text("destination"), searchPhrases: Array.isArray(input.searchPhrases) ? input.searchPhrases.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 160)] : []).slice(0, 8) : [] };
}


export function authoritativePrimarySource(result: Record<string, unknown>, sources: AIReadinessPackage["verificationSources"]) {
  const sourceTitle = typeof result.sourceTitle === "string" ? result.sourceTitle.trim().slice(0, 140) : "";
  const sourceUrl = typeof result.sourceUrl === "string" ? result.sourceUrl.trim() : "";
  const sourceOrganization = typeof result.sourceOrganization === "string" ? result.sourceOrganization.trim().slice(0, 120) : "";
  const directSourceType = sourceTypeForUrl(sourceUrl, sourceOrganization);
  const directSource = sourceTitle && sourceOrganization && isAuthoritativeUrl(sourceUrl, directSourceType, sourceOrganization)
    ? {
      title: sourceTitle,
      organization: sourceOrganization,
      url: sourceUrl,
      type: directSourceType,
      retrievedAt: checkedDate(result.lastChecked, result.lastVerifiedAt),
    }
    : null;
  if (directSource) return directSource;
  return sources[0] ?? null;
}


export function verificationSources(value: unknown): AIReadinessPackage["verificationSources"] {
  if (!Array.isArray(value)) return [];
  return rankSources(value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const organization = typeof item.organization === "string" ? item.organization.trim().slice(0, 120) : "";
      const url = typeof item.url === "string" ? item.url.trim() : "";
      return {
        title: typeof item.title === "string" ? item.title.trim().slice(0, 140) : "",
        organization,
        url,
        type: sourceTypeForUrl(url, organization, isSourceType(item.type) ? item.type : "official"),
        retrievedAt: typeof item.retrievedAt === "string" && !Number.isNaN(Date.parse(item.retrievedAt)) ? new Date(item.retrievedAt).toISOString() : new Date().toISOString(),
      };
    })
    .filter((source) => source.title && source.organization && isAuthoritativeUrl(source.url, source.type, source.organization))
    .slice(0, 8));
}


export function checkedDate(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
      return new Date(value).toISOString();
    }
  }
  return new Date().toISOString();
}


export function isSourceType(value: unknown): value is AIReadinessPackage["verificationSources"][number]["type"] {
  return typeof value === "string" && ["government", "official", "bank", "university", "insurance", "authority"].includes(value);
}


export function isAuthoritativeUrl(value: string, sourceType: AIReadinessPackage["verificationSources"][number]["type"], sourceName = "") {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const sourceText = `${sourceName.toLowerCase()} ${host}`;
    const blocked = ["reddit.", "quora.", "medium.", "blogspot.", "wordpress.", "tripadvisor.", "visaguide.", "y-axis.", "makevisas.", "btwvisas.", "atlys.", "wikipedia."];
    if (blocked.some((domain) => host.includes(domain))) return false;
    if (sourceType === "bank" && (sourceText.includes("bank") || sourceText.includes("credit union") || sourceText.includes("federal credit"))) return true;
    if (sourceType === "university" && (host.endsWith(".edu") || host.includes(".edu.") || host.includes(".ac.") || sourceText.includes("university") || sourceText.includes("college"))) return true;
    if (sourceType === "insurance" && (sourceText.includes("insurance") || sourceText.includes("insurer"))) return true;
    if (sourceType === "official" || sourceType === "authority") {
      const knownOfficialHosts = ["ucas.com", "vfsglobal.com", "ox.ac.uk", "harvard.edu", "homeaffairs.gov.au", "travel.state.gov", "ielts.org", "toefl.org", "ets.org"];
      if (knownOfficialHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) return true;
    }
    if ((sourceType === "official" || sourceType === "authority") && (host.endsWith(".org") || host.includes(".org."))) return true;
    return /\.(gov|gob|go|gc|gouv|govt)\./.test(host) ||
      host.endsWith(".gov") ||
      host.endsWith(".go.jp") ||
      host.endsWith(".gov.in") ||
      host.includes("embassy") ||
      host.includes("emb-japan") ||
      host.includes("mofa.go.jp") ||
      host.includes("canada.ca") ||
      host.includes("immigration") ||
      host.includes("vfs");
  } catch {
    return false;
  }
}


export function sourceTypeForUrl(value: string, sourceName = "", fallback: AIReadinessPackage["verificationSources"][number]["type"] = "official"): AIReadinessPackage["verificationSources"][number]["type"] {
  const host = hostForUrl(value);
  const sourceText = `${sourceName.toLowerCase()} ${host}`;
  if (host.endsWith(".edu") || host.includes(".edu.") || host.includes(".ac.") || sourceText.includes("university") || sourceText.includes("college")) return "university";
  if (sourceText.includes("bank") || sourceText.includes("credit union") || sourceText.includes("federal credit")) return "bank";
  if (sourceText.includes("insurance") || sourceText.includes("insurer")) return "insurance";
  if (host.includes("gov") || host.includes("gouv") || host.includes("canada.ca") || host.includes("mofa.go.jp")) return "government";
  return fallback;
}


export function authoritativeSourceTypeForRequiredDocument(value: Record<string, unknown>): AIReadinessPackage["verificationSources"][number]["type"] {
  const explicitTier = String(value.sourceAuthorityTier);
  if (explicitTier === "government" || explicitTier === "authority") return explicitTier;
  const url = typeof value.sourceUrl === "string" ? value.sourceUrl : "";
  const sourceName = typeof value.sourceName === "string" ? value.sourceName.toLowerCase() : "";
  const host = hostForUrl(url);
  const sourceText = `${sourceName} ${host}`;
  if (host.endsWith(".edu") || host.includes(".edu.") || host.includes(".ac.") || sourceText.includes("university") || sourceText.includes("college")) return "university";
  if (sourceText.includes("bank") || sourceText.includes("credit union") || sourceText.includes("federal credit")) return "bank";
  if (sourceText.includes("insurance") || sourceText.includes("insurer")) return "insurance";
  if (host.includes("gov") || host.includes("gouv") || host.includes("canada.ca") || host.includes("mofa.go.jp")) return "government";
  return "official";
}


export function hostForUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}


export function isRequiredDocument(item: unknown): item is AIReadinessPackage["requiredDocuments"][number] {
  if (!item || typeof item !== "object") return false;
  const value = item as Record<string, unknown>;
  return typeof value.id === "string" && typeof value.category === "string" && typeof value.documentType === "string" && typeof value.owner === "string" && typeof value.name === "string" && typeof value.title === "string" && typeof value.required === "boolean" && typeof value.whyNeeded === "string" && Boolean(value.whyNeeded.trim()) && typeof value.sourceName === "string" && Boolean(value.sourceName.trim()) && typeof value.sourceUrl === "string" && ["government", "authority", "official", "commercial", "aggregator"].includes(String(value.sourceAuthorityTier)) && isAuthoritativeUrl(value.sourceUrl, authoritativeSourceTypeForRequiredDocument(value), value.sourceName) && typeof value.lastVerifiedAt === "string" && !Number.isNaN(Date.parse(value.lastVerifiedAt));
}


export function isGuidanceDocument(item: unknown): item is AIReadinessPackage["requiredDocuments"][number] {
  if (!item || typeof item !== "object") return false;
  const value = item as Record<string, unknown>;
  return typeof value.id === "string"
    && typeof value.category === "string"
    && typeof value.documentType === "string"
    && typeof value.owner === "string"
    && typeof value.name === "string"
    && typeof value.title === "string"
    && typeof value.required === "boolean"
    && typeof value.whyNeeded === "string"
    && Boolean(value.whyNeeded.trim())
    && typeof value.sourceName === "string"
    && typeof value.sourceUrl === "string"
    && ["government", "authority", "official", "commercial", "aggregator"].includes(String(value.sourceAuthorityTier));
}


export function normalizeId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100);
}

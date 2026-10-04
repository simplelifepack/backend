import type { ReadinessPack, Requirement } from "@prisma/client";
import type { RefreshChecklist, RefreshSource } from "../../ai/packageRefreshSchema";
import { PackageRefreshError } from "../../ai/researchPackageRefresh";
import { normalizeDocumentType } from "./normalization";

export function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function sameRefreshData(left: unknown, right: unknown): boolean {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["checkedAt", "retrievedAt", "lastVerifiedAt", "lastCheckedAt", "sourceEvidence"].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
    return value;
  };
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

export function planPackageRefresh(pack: ReadinessPack & { requirements: Requirement[] }, checklist: RefreshChecklist, sources: RefreshSource[]) {
  const used = new Set<string>();
  const keys = new Set<string>();
  const requirements = checklist.requirements.map((item, sortOrder) => {
    const documentType = normalizeDocumentType(item.documentType);
    const key = `${documentType}:${item.owner}:${item.title.toLowerCase()}`;
    if (keys.has(key)) throw new PackageRefreshError("The researched checklist contains duplicate requirements.");
    keys.add(key);
    const explicit = item.existingId ? pack.requirements.find(row => row.id === item.existingId) : undefined;
    if (item.existingId && (!explicit || normalizeDocumentType(explicit.documentType) !== documentType || explicit.owner !== item.owner)) throw new PackageRefreshError("The researched requirement identity could not be verified.");
    const matching = pack.requirements.filter(row => !used.has(row.id) && normalizeDocumentType(row.documentType) === documentType && row.owner === item.owner);
    const current = explicit ?? matching.find(row => row.title.toLowerCase() === item.title.toLowerCase()) ?? (matching.length === 1 ? matching[0] : undefined);
    if (current && used.has(current.id)) throw new PackageRefreshError("The researched checklist reused a requirement ID.");
    if (current) used.add(current.id);
    const metadata: Record<string, unknown> = { ...jsonObject(current?.metadata), sourceUrl: item.sourceUrl, sourceEvidence: item.evidence };
    delete metadata.refreshRetired;
    if (item.condition) metadata.condition = item.condition; else delete metadata.condition;
    if (item.maxAgeDays !== null) metadata.maxAgeDays = item.maxAgeDays; else delete metadata.maxAgeDays;
    const data = {
      title: item.title, description: item.description, documentType, owner: item.owner,
      required: item.required, group: item.group,
      acceptedDocumentTypes: [...new Set(item.acceptedDocumentTypes.map(value => normalizeDocumentType(value)))].sort(),
      alternativeLabels: [...new Set(item.alternativeLabels)].sort(), metadata, sortOrder,
    };
    const previous = current ? Object.fromEntries(Object.keys(data).map(key => [key, current[key as keyof Requirement]])) : null;
    return { id: current?.id, data, changed: !sameRefreshData(previous, data) };
  });
  const retired = pack.requirements.filter(row => !used.has(row.id) && jsonObject(row.metadata).refreshRetired !== true);
  const oldSources = Array.isArray(pack.verificationSources) ? pack.verificationSources : [];
  const verificationSources = sources.map(source => {
    const existing = jsonObject(oldSources.find(item => jsonObject(item).url === source.url));
    return { ...existing, ...source, ...("sourceScope" in existing ? { sourceScope: source.scope } : {}) };
  });
  const searchMetadata: Record<string, unknown> = { ...jsonObject(pack.searchMetadata), confidence: checklist.confidence, disclaimer: checklist.disclaimer };
  if ("requiredDocuments" in searchMetadata) searchMetadata.requiredDocuments = checklist.requirements.filter(item => item.required).map(item => item.title);
  if ("conditionalRequirements" in searchMetadata) searchMetadata.conditionalRequirements = checklist.requirements.filter(item => item.condition).map(item => ({ title: item.title, condition: item.condition }));
  for (const [key, value] of Object.entries(checklist.applicability)) if (value !== null && (!Array.isArray(value) || value.length)) searchMetadata[key] = value;
  const primary = sources[0]!;
  const data = { searchMetadata, verificationSources, sourceName: primary.organization, sourceTitle: primary.title, sourceUrl: primary.url, verificationStatus: "verified" };
  const previous = Object.fromEntries(Object.keys(data).map(key => [key, pack[key as keyof ReadinessPack]]));
  return { requirements, retired, data, changed: requirements.some(item => item.changed) || retired.length > 0 || !sameRefreshData(previous, data) };
}
